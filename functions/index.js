const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// 1. Notify group members when a new expense is added
exports.onexpenseadded = onDocumentUpdated("groups/{groupId}", async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const beforeExpenses = beforeData.expenses || [];
    const afterExpenses = afterData.expenses || [];

    // Check if a new expense was added
    if (afterExpenses.length > beforeExpenses.length) {
        const newExpense = afterExpenses[afterExpenses.length - 1];
        
        // Ignore settlement expenses to avoid spamming "settled up" as an expense (or maybe we do want to notify? The user said "someone adds an expense")
        // If it's a settlement, it usually starts with 'set_' or has a specific description, but we can notify for settlements too as they are important.
        
        const groupName = afterData.name || "A Trip";
        const payerId = (newExpense.payers && newExpense.payers.length > 0) ? newExpense.payers[0].personId : newExpense.payerId;
        const payerPerson = afterData.people.find(p => p.id === payerId);
        const payerName = payerPerson ? payerPerson.name : "Someone";
        
        // If it's a settlement, the description usually says "Settlement..."
        const description = newExpense.description || "an expense";
        const isSettlement = newExpense.id && newExpense.id.startsWith('set_');
        
        let title, body;
        if (isSettlement) {
            title = `Payment recorded in ${groupName}`;
            body = `${description}`;
        } else {
            const amount = Number(newExpense.amount).toFixed(2);
            const currency = newExpense.currency || 'USD';
            title = `New expense in ${groupName}`;
            body = `${payerName} paid ${amount} ${currency} for "${description}".`;
        }

        const peopleToNotify = afterData.people.filter(p => p.id !== payerId);
        const tokens = [];

        for (const person of peopleToNotify) {
            if (!person.userId) continue; // Skip dummy members who don't have a linked account
            try {
                const userDoc = await db.collection("users").doc(person.userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    if (userData.fcmToken) {
                        tokens.push(userData.fcmToken);
                    }
                }
            } catch (err) {
                console.error(`Error fetching user ${person.userId}:`, err);
            }
        }

        if (tokens.length > 0) {
            try {
                const response = await admin.messaging().sendEachForMulticast({
                    notification: { title, body },
                    tokens: tokens
                });
                console.log(`Sent expense notification to ${response.successCount} devices.`);
            } catch (err) {
                console.error("Error sending messages:", err);
            }
        }
    }
});

// Advances a 'YYYY-MM-DD' date string by one period (UTC-based).
function addPeriod(dateStr, frequency) {
    const d = new Date(dateStr + "T00:00:00Z");
    if (frequency === "weekly") {
        d.setUTCDate(d.getUTCDate() + 7);
    } else {
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.toISOString().slice(0, 10);
}

// 2. Recurring Expenses: auto-add due expenses and notify their creator (Runs daily)
exports.processrecurringexpenses = onSchedule("0 13 * * *", async (event) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const groupsSnapshot = await db.collection("groups").get();

    for (const groupDoc of groupsSnapshot.docs) {
        const group = groupDoc.data();
        const templates = group.recurringExpenses || [];
        const hasDue = templates.some(r => r.active && r.nextDate <= todayStr);
        if (!hasDue) continue;

        // uid -> array of { description, amount, currency, groupName }
        const notifyMap = {};

        try {
            await db.runTransaction(async (t) => {
                const ref = groupDoc.ref;
                const freshDoc = await t.get(ref);
                if (!freshDoc.exists) return;

                const freshData = freshDoc.data();
                const expenses = freshData.expenses || [];
                const freshTemplates = freshData.recurringExpenses || [];

                freshTemplates.forEach(template => {
                    if (!template.active) return;

                    let next = template.nextDate;
                    let addedCount = 0;
                    // Cap catch-up so a long-dormant template can't flood the group.
                    while (next && next <= todayStr && addedCount < 6) {
                        expenses.push({
                            id: "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
                            description: template.description,
                            amount: template.amount,
                            currency: template.currency,
                            payerId: template.payerId,
                            payers: template.payers,
                            splitType: template.splitType,
                            participants: template.participants,
                            recurringId: template.id
                        });

                        if (template.createdBy) {
                            if (!notifyMap[template.createdBy]) notifyMap[template.createdBy] = [];
                            notifyMap[template.createdBy].push({
                                description: template.description,
                                amount: template.amount,
                                currency: template.currency,
                                groupName: freshData.name || "your group"
                            });
                        }

                        next = addPeriod(next, template.frequency);
                        addedCount++;
                    }
                    template.nextDate = next;
                });

                t.update(ref, { expenses, recurringExpenses: freshTemplates });
            });
        } catch (err) {
            console.error(`Error processing recurring expenses for group ${groupDoc.id}:`, err);
            continue;
        }

        // Notify each creator directly that their recurring expense was just added.
        for (const [uid, items] of Object.entries(notifyMap)) {
            try {
                const userDoc = await db.collection("users").doc(uid).get();
                const token = userDoc.exists && userDoc.data().fcmToken;
                if (!token) continue;

                for (const item of items) {
                    const amount = Number(item.amount).toFixed(2);
                    try {
                        await admin.messaging().send({
                            notification: {
                                title: "Recurring expense added 🔁",
                                body: `"${item.description}" (${amount} ${item.currency}) was just added to ${item.groupName}.`
                            },
                            token
                        });
                    } catch (err) {
                        console.error(`Error sending recurring notification to ${uid}:`, err);
                    }
                }
            } catch (err) {
                console.error(`Error fetching user ${uid} for recurring notification:`, err);
            }
        }
    }
});

// 3. Monthly Reminder for unsettled balances (Runs on the 1st of every month)
exports.monthlyreminder = onSchedule("0 0 1 * *", async (event) => {
    // Get all groups
    const groupsSnapshot = await db.collection("groups").get();
    
    // We will keep track of users who owe money
    const usersOweMoney = new Set();
    
    groupsSnapshot.forEach(doc => {
        const group = doc.data();
        if (!group.people || !group.expenses) return;

        // Calculate balances for this group
        const balances = {};
        group.people.forEach(p => {
            balances[p.id] = {};
        });

        group.expenses.forEach(e => {
            const amount = Number(e.amount) || 0;
            const cur = e.currency || 'USD';

            // Payers
            if (e.payers && e.payers.length > 0) {
                e.payers.forEach(payer => {
                    if (balances[payer.personId]) {
                        if (!balances[payer.personId][cur]) balances[payer.personId][cur] = 0;
                        balances[payer.personId][cur] += Number(payer.amount) || 0;
                    }
                });
            } else if (balances[e.payerId]) {
                if (!balances[e.payerId][cur]) balances[e.payerId][cur] = 0;
                balances[e.payerId][cur] += amount;
            }

            // Participants
            let totalShares = 0;
            if (e.splitType === 'shares') {
                totalShares = e.participants.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
            }

            e.participants.forEach(p => {
                if (!balances[p.personId]) return;

                let debt = 0;
                const participantShare = Number(p.share) || 0;

                if (e.splitType === 'equal' || !e.splitType) {
                    debt = amount / Math.max(1, e.participants.length);
                } else if (e.splitType === 'exact' || e.splitType === 'paid_for') {
                    debt = participantShare;
                } else if (e.splitType === 'percent') {
                    debt = (amount * participantShare) / 100;
                } else if (e.splitType === 'shares' && totalShares > 0) {
                    debt = amount * (participantShare / totalShares);
                }

                if (!balances[p.personId][cur]) balances[p.personId][cur] = 0;
                balances[p.personId][cur] -= debt;
            });
        });

        // Create a map of personId -> userId
        const personIdToUserId = {};
        group.people.forEach(p => {
            if (p.userId) {
                personIdToUserId[p.id] = p.userId;
            }
        });

        // Determine if anyone has a net negative balance in any currency
        for (const [personId, personBals] of Object.entries(balances)) {
            for (const [cur, netAmt] of Object.entries(personBals)) {
                // If net amount is negative, this person owes money
                if (netAmt <= -0.01) {
                    const uid = personIdToUserId[personId];
                    if (uid) {
                        usersOweMoney.add(uid);
                    }
                    break;
                }
            }
        }
    });

    // For all users who owe money, fetch their FCM token and notify them
    const tokens = [];
    for (const userId of usersOweMoney) {
        try {
            const userDoc = await db.collection("users").doc(userId).get();
            if (userDoc.exists && userDoc.data().fcmToken) {
                tokens.push(userDoc.data().fcmToken);
            }
        } catch (err) {
            console.error(`Error fetching user ${userId}:`, err);
        }
    }

    if (tokens.length > 0) {
        try {
            const response = await admin.messaging().sendEachForMulticast({
                notification: {
                    title: "End of Month Reminder 📅",
                    body: "You have unsettled group expenses! Don't forget to settle up your balances in Splitfool."
                },
                tokens: tokens
            });
            console.log(`Sent monthly reminders to ${response.successCount} devices.`);
        } catch (err) {
            console.error("Error sending reminders:", err);
        }
    } else {
        console.log("No users owe money or no tokens found for monthly reminder.");
    }
});

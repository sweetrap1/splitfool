/**
 * Calculates balances for all people in a group.
 * Returns an object: { [personId]: { [currency]: balance } }
 */
export function calculateBalances(activeGroup, ignoreSettlements = false) {
    if (!activeGroup || !activeGroup.people) return {};

    const balances = {};

    // Initialize all people
    activeGroup.people.forEach(p => {
        balances[p.id] = {};
    });

    if (!activeGroup.expenses) return balances;

    // Calculate per expense
    activeGroup.expenses.forEach(e => {
        if (ignoreSettlements && (e.isSettlement || (e.id && e.id.startsWith('set_')))) return;

        const amount = Number(e.amount) || 0;
        const cur = e.currency || 'USD';

        // Credit the payer(s)
        if (e.payers && e.payers.length > 0) {
            e.payers.forEach(payer => {
                if (balances[payer.personId]) {
                    if (!balances[payer.personId][cur]) balances[payer.personId][cur] = 0;
                    balances[payer.personId][cur] += Number(payer.amount) || 0;
                }
            });
        } else if (balances[e.payerId]) { // Fallback for legacy single payer
            if (!balances[e.payerId][cur]) balances[e.payerId][cur] = 0;
            balances[e.payerId][cur] += amount;
        }

        // Debit the participants
        if (!e.participants || e.participants.length === 0) return;

        let totalShares = 0;
        if (e.splitType === 'shares') {
            totalShares = e.participants.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
        }

        let totalDebited = 0;
        const processedParticipants = [];

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
            } else if (e.splitType === 'shares') {
                if (totalShares > 0) {
                    debt = amount * (participantShare / totalShares);
                }
            }

            // Round debt to nearest cent
            debt = Math.round(debt * 100) / 100;
            totalDebited += debt;
            processedParticipants.push({ personId: p.personId, debt, currency: cur });
        });

        // Penny Leak Protection: Adjust for rounding errors
        // (Only for equal splits or those meant to total the amount)
        if (['equal', 'exact', 'percent', 'shares', 'paid_for'].includes(e.splitType || 'equal')) {
            let diff = Math.round((amount - totalDebited) * 100) / 100;

            // Distribute pennies if there's a small difference (rounding error)
            // Usually diff is 0.01, -0.01, etc.
            if (Math.abs(diff) > 0 && Math.abs(diff) < 0.1) {
                const step = diff > 0 ? 0.01 : -0.01;
                let i = 0;
                while (Math.abs(diff) >= 0.009 && i < processedParticipants.length) {
                    processedParticipants[i].debt += step;
                    diff -= step;
                    i++;
                }
            }
        }

        processedParticipants.forEach(p => {
            if (!balances[p.personId][p.currency]) balances[p.personId][p.currency] = 0;
            balances[p.personId][p.currency] -= Math.round(p.debt * 100) / 100;
        });
    });

    // Final pass: snap every balance to nearest cent
    for (const personId of Object.keys(balances)) {
        for (const cur of Object.keys(balances[personId])) {
            balances[personId][cur] = Math.round(balances[personId][cur] * 100) / 100;
        }
    }

    return balances;
}

/**
 * Simplifies debts for a specific currency using a greedy algorithm.
 */
export function simplifyDebts(balances, currency) {
    const debtors = [];
    const creditors = [];

    // Separate into debtors and creditors for the specific currency
    for (const [personId, personBals] of Object.entries(balances)) {
        const bal = personBals[currency] || 0;
        if (bal < -0.01) {
            debtors.push({ id: personId, amount: Math.abs(bal) });
        } else if (bal > 0.01) {
            creditors.push({ id: personId, amount: bal });
        }
    }

    // Sort descending by amount to minimize transactions
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let i = 0; // debtor index
    let j = 0; // creditor index

    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];

        const amount = Math.min(debtor.amount, creditor.amount);

        if (amount > 0.005) {
            transactions.push({
                from: debtor.id,
                to: creditor.id,
                amount: Math.round(amount * 100) / 100
            });
        }

        debtor.amount -= amount;
        creditor.amount -= amount;

        if (debtor.amount < 0.01) i++;
        if (creditor.amount < 0.01) j++;
    }

    return transactions;
}

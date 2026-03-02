
// Extracting core logic from app.js for reproduction
function calculateBalances(people, expenses) {
    const balances = {};
    people.forEach(p => {
        balances[p.id] = {};
    });

    expenses.forEach(e => {
        const amount = e.amount;
        const cur = e.currency;

        if (balances[e.payerId]) {
            if (!balances[e.payerId][cur]) balances[e.payerId][cur] = 0;
            balances[e.payerId][cur] += amount;
        }

        let totalShares = 0;
        if (e.splitType === 'shares') {
            totalShares = e.participants.reduce((sum, p) => sum + p.share, 0);
        }

        e.participants.forEach(p => {
            if (!balances[p.personId]) return;

            let debt = 0;
            if (e.splitType === 'equal') {
                debt = amount / e.participants.length;
            } else if (e.splitType === 'exact' || e.splitType === 'paid_for') {
                debt = p.share;
            } else if (e.splitType === 'percent') {
                debt = (amount * p.share) / 100;
            } else if (e.splitType === 'shares') {
                if (totalShares > 0) {
                    debt = amount * (p.share / totalShares);
                }
            }

            if (!balances[p.personId][cur]) balances[p.personId][cur] = 0;
            balances[p.personId][cur] -= debt;
        });
    });

    return balances;
}

function simplifyDebts(balances, currency) {
    const debtors = [];
    const creditors = [];

    for (const [personId, personBals] of Object.entries(balances)) {
        const bal = personBals[currency];
        if (bal < -0.01) {
            debtors.push({ id: personId, amount: Math.abs(bal) });
        } else if (bal > 0.01) {
            creditors.push({ id: personId, amount: bal });
        }
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let i = 0; j = 0;
    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];
        const amount = Math.min(debtor.amount, creditor.amount);
        transactions.push({ from: debtor.id, to: creditor.id, amount: amount });
        debtor.amount -= amount;
        creditor.amount -= amount;
        if (debtor.amount < 0.01) i++;
        if (creditor.amount < 0.01) j++;
    }
    return transactions;
}

// Reproduction Data
const people = Array.from({ length: 11 }, (_, i) => ({ id: `p${i + 1}`, name: `Person ${i + 1}` }));

// Simulate some expenses
const expenses = [
    {
        id: 'e1', description: 'USD Dinner', amount: 110, currency: 'USD', payerId: 'p1', splitType: 'equal',
        participants: people.map(p => ({ personId: p.id }))
    },
    {
        id: 'e2', description: 'PHP Trip', amount: 5500, currency: 'PHP', payerId: 'p2', splitType: 'equal',
        participants: people.map(p => ({ personId: p.id }))
    },
    {
        id: 'e3', description: 'USD Lunch', amount: 55, currency: 'USD', payerId: 'p3', splitType: 'equal',
        participants: people.map(p => ({ personId: p.id }))
    },
    {
        id: 'e4', description: 'PHP Drinks', amount: 1100, currency: 'PHP', payerId: 'p4', splitType: 'equal',
        participants: people.map(p => ({ personId: p.id }))
    }
];

const balances = calculateBalances(people, expenses);

console.log("--- SEPARATE CURRENCIES ---");
['USD', 'PHP'].forEach(cur => {
    const txs = simplifyDebts(balances, cur);
    console.log(`\n${cur} Transactions:`);
    txs.forEach(tx => console.log(`${tx.from} pays ${tx.to}: ${tx.amount.toFixed(2)} ${cur}`));
});

// Combined Mode
const exchangeRates = { 'USD': 1, 'PHP': 55 }; // 1 USD = 55 PHP approx
const targetCurrency = 'PHP';
const combinedBalances = {};

for (const [personId, personBals] of Object.entries(balances)) {
    let combinedAmount = 0;
    for (const [cur, amt] of Object.entries(personBals)) {
        if (cur === targetCurrency) {
            combinedAmount += amt;
        } else {
            const amountInUSD = amt / (exchangeRates[cur] || 1);
            const amountInTarget = amountInUSD * (exchangeRates[targetCurrency] || 1);
            combinedAmount += amountInTarget;
        }
    }
    combinedBalances[personId] = { [targetCurrency]: combinedAmount };
}

console.log("\n\n--- COMBINED PHP ---");
const combinedTxs = simplifyDebts(combinedBalances, targetCurrency);
combinedTxs.forEach(tx => console.log(`${tx.from} pays ${tx.to}: ${tx.amount.toFixed(2)} ${targetCurrency}`));

const totalTransactionsSeparate = ['USD', 'PHP'].reduce((sum, cur) => sum + simplifyDebts(balances, cur).length, 0);
const totalTransactionsCombined = combinedTxs.length;

console.log(`\nTotal Transactions (Separate): ${totalTransactionsSeparate}`);
console.log(`Total Transactions (Combined): ${totalTransactionsCombined}`);

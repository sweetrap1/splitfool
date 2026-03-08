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

/**
 * Calculates direct "traditional" debts between people.
 * Netting is applied per-pair (A->B and B->A offset each other).
 *
 * Negative-amount expenses (refunds/credits) are handled by reversing
 * the debt direction: the payer becomes the receiver and vice-versa.
 *
 * Two-pass approach:
 *   Pass 1 – build pairwise debts from regular expenses (including refunds).
 *   Pass 2 – subtract recorded settlements from those pairwise debts.
 */
export function calculateDirectDebts(activeGroup, targetCurrency = null, exchangeRates = null) {
    if (!activeGroup || !activeGroup.people || !activeGroup.expenses) return [];

    // Map: { [p1_id]: { [p2_id]: { [currency]: net } } }
    // Keys are always sorted so p1 < p2 lexicographically.
    // Positive net  → p1 owes p2
    // Negative net  → p2 owes p1
    const pairDebts = {};

    /**
     * Record that `fromId` owes `toId` `amount` in `cur`.
     * Negative amounts are refunds: flip direction and call recursively.
     * Zero amounts are ignored.
     */
    const addDebt = (fromId, toId, amount, cur) => {
        if (!fromId || !toId || fromId === toId || amount === 0) return;
        if (amount < 0) {
            // Refund/credit: the money flows back the other way
            addDebt(toId, fromId, -amount, cur);
            return;
        }
        const [p1, p2] = [fromId, toId].sort();
        const sign = (p1 === fromId) ? 1 : -1;
        if (!pairDebts[p1]) pairDebts[p1] = {};
        if (!pairDebts[p1][p2]) pairDebts[p1][p2] = {};
        if (!pairDebts[p1][p2][cur]) pairDebts[p1][p2][cur] = 0;
        pairDebts[p1][p2][cur] += (amount * sign);
    };

    /**
     * Record that `fromId` has paid `toId` `amount` in `cur`
     * (reduces the existing pairwise debt in that direction).
     */
    const reduceDebt = (fromId, toId, amount, cur) => {
        if (!fromId || !toId || fromId === toId || amount <= 0) return;
        const [p1, p2] = [fromId, toId].sort();
        const sign = (p1 === fromId) ? 1 : -1;
        if (!pairDebts[p1]) pairDebts[p1] = {};
        if (!pairDebts[p1][p2]) pairDebts[p1][p2] = {};
        if (!pairDebts[p1][p2][cur]) pairDebts[p1][p2][cur] = 0;
        pairDebts[p1][p2][cur] -= (amount * sign);
    };

    // ── PASS 1: build raw pairwise debts from every non-settlement expense ──
    activeGroup.expenses.forEach(e => {
        const isSettlement = e.isSettlement || (e.id && e.id.startsWith('set_'));
        if (isSettlement) return;

        const totalAmount = Number(e.amount) || 0;
        const cur = e.currency || 'USD';

        // Skip zero-amount expenses only; negative amounts are valid refunds
        if (totalAmount === 0 || !e.participants || !e.participants.length) return;

        // Build payer list (support multi-payer and legacy single-payer)
        const payers = [];
        if (e.payers && e.payers.length > 0) {
            e.payers.forEach(p => payers.push({ id: p.personId, amount: Number(p.amount) || 0 }));
        } else if (e.payerId || e.paidBy) {
            payers.push({ id: e.payerId || e.paidBy, amount: totalAmount });
        }
        if (!payers.length) return;

        let totalShares = 0;
        if (e.splitType === 'shares') {
            totalShares = e.participants.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
        }

        e.participants.forEach(p => {
            let debt = 0;
            const pShare = Number(p.share) || 0;

            if (e.splitType === 'equal' || !e.splitType) {
                debt = totalAmount / Math.max(1, e.participants.length);
            } else if (e.splitType === 'exact' || e.splitType === 'paid_for') {
                debt = pShare;
            } else if (e.splitType === 'percent') {
                debt = (totalAmount * pShare) / 100;
            } else if (e.splitType === 'shares') {
                if (totalShares !== 0) debt = totalAmount * (pShare / totalShares);
            }

            if (debt === 0) return;

            // Each payer is owed their proportional share of this participant's portion
            payers.forEach(payer => {
                if (p.personId === payer.id) return; // Payer doesn't owe themselves
                const shareOfPayer = debt * (payer.amount / totalAmount);
                if (Math.abs(shareOfPayer) > 0.001) {
                    addDebt(p.personId, payer.id, shareOfPayer, cur);
                }
            });
        });
    });

    // ── PASS 2: subtract all recorded settlements ──
    activeGroup.expenses.forEach(e => {
        const isSettlement = e.isSettlement || (e.id && e.id.startsWith('set_'));
        if (!isSettlement) return;

        const amount = Number(e.amount) || 0;
        const cur = e.currency || 'USD';
        if (amount <= 0) return;

        // Settlement: payerId paid, participants[0] received
        const fromId = e.payerId || (e.payers && e.payers[0]?.personId);
        const toId = e.participants && e.participants[0]?.personId;
        if (fromId && toId) {
            reduceDebt(fromId, toId, amount, cur);
        }
    });

    // ── Convert pairDebts map into a flat transaction list ──
    const rawTransactions = [];
    Object.keys(pairDebts).forEach(p1 => {
        Object.keys(pairDebts[p1]).forEach(p2 => {
            Object.keys(pairDebts[p1][p2]).forEach(cur => {
                const net = pairDebts[p1][p2][cur];
                if (Math.abs(net) < 0.005) return; // ignore sub-cent noise
                if (net > 0) {
                    rawTransactions.push({ from: p1, to: p2, amount: net, currency: cur });
                } else {
                    rawTransactions.push({ from: p2, to: p1, amount: Math.abs(net), currency: cur });
                }
            });
        });
    });

    // ── Optional: merge all currencies into a single target currency ──
    if (targetCurrency && targetCurrency !== 'separate') {
        const mergedDebts = {};
        rawTransactions.forEach(tx => {
            let amount = tx.amount;
            if (tx.currency !== targetCurrency && exchangeRates) {
                const fromInUsd = tx.currency === 'USD' ? 1 : (1 / (exchangeRates[tx.currency] || 1));
                const targetRate = targetCurrency === 'USD' ? 1 : (exchangeRates[targetCurrency] || 1);
                amount *= (fromInUsd * targetRate);
            }
            const [p1, p2] = [tx.from, tx.to].sort();
            const sign = (p1 === tx.from) ? 1 : -1;
            if (!mergedDebts[p1]) mergedDebts[p1] = {};
            if (!mergedDebts[p1][p2]) mergedDebts[p1][p2] = 0;
            mergedDebts[p1][p2] += (amount * sign);
        });

        const finalTransactions = [];
        Object.keys(mergedDebts).forEach(p1 => {
            Object.keys(mergedDebts[p1]).forEach(p2 => {
                const net = mergedDebts[p1][p2];
                if (Math.abs(net) < 0.01) return;
                if (net > 0) {
                    finalTransactions.push({ from: p1, to: p2, amount: Math.round(net * 100) / 100, currency: targetCurrency });
                } else {
                    finalTransactions.push({ from: p2, to: p1, amount: Math.round(Math.abs(net) * 100) / 100, currency: targetCurrency });
                }
            });
        });
        return finalTransactions;
    }

    rawTransactions.forEach(t => t.amount = Math.round(t.amount * 100) / 100);
    return rawTransactions;
}

// Recurring Expenses API
import { db } from '../firebase-init.js';
import { getActiveGroup, state } from '../state.js';

// Computes the next occurrence date (YYYY-MM-DD, UTC) for a recurring expense,
// one period after today since today's expense was just added.
export function nextRecurringDate(frequency) {
    const d = new Date();
    if (frequency === 'weekly') {
        d.setUTCDate(d.getUTCDate() + 7);
    } else {
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.toISOString().slice(0, 10);
}

export async function addRecurringExpense(template, id) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    return db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(activeGroup.id);
        const doc = await t.get(ref);
        if (!doc.exists) return;

        const groupData = doc.data();
        const recurringExpenses = groupData.recurringExpenses || [];
        recurringExpenses.push({
            id: id || ('rec_' + Date.now()),
            createdBy: state.currentUser ? state.currentUser.uid : null,
            active: true,
            ...template
        });
        t.update(ref, { recurringExpenses });
    });
}

export async function deleteRecurringExpense(id) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    return db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(activeGroup.id);
        const doc = await t.get(ref);
        if (!doc.exists) return;

        const groupData = doc.data();
        const recurringExpenses = (groupData.recurringExpenses || []).filter(r => r.id !== id);
        t.update(ref, { recurringExpenses });
    });
}

export async function toggleRecurringExpenseActive(id) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    return db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(activeGroup.id);
        const doc = await t.get(ref);
        if (!doc.exists) return;

        const groupData = doc.data();
        const recurringExpenses = groupData.recurringExpenses || [];
        const index = recurringExpenses.findIndex(r => r.id === id);
        if (index === -1) return;

        recurringExpenses[index].active = !recurringExpenses[index].active;
        // If resuming, push the next date forward so a paused expense doesn't
        // immediately fire a backlog of missed occurrences.
        if (recurringExpenses[index].active) {
            recurringExpenses[index].nextDate = nextRecurringDate(recurringExpenses[index].frequency);
        }
        t.update(ref, { recurringExpenses });
    });
}

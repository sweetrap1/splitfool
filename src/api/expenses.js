// Expenses API
import { getActiveGroup } from '../state.js';
import { saveGroupState } from './groups.js';

export async function addExpense(expenseData) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;
    if (!expenseData.createdAt) {
        expenseData.createdAt = new Date().toISOString();
    }
    activeGroup.expenses.push(expenseData);
    return saveGroupState(activeGroup);
}

export async function editExpense(expenseId, updatedData) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    const index = activeGroup.expenses.findIndex(e => e.id === expenseId);
    if (index !== -1) {
        activeGroup.expenses[index] = { ...activeGroup.expenses[index], ...updatedData };
        return saveGroupState(activeGroup);
    }
}

export async function deleteExpense(expenseId) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    activeGroup.expenses = activeGroup.expenses.filter(e => e.id !== expenseId);
    return saveGroupState(activeGroup);
}

/**
 * Archives all non-archived expenses in the active group.
 * Sets isArchived: true on every expense (including settlements).
 * This is the "Evergreen" reset — balances become $0, history is preserved.
 */
export async function archiveSettledExpenses() {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;
    if (!activeGroup.expenses || activeGroup.expenses.length === 0) return;

    let didChange = false;
    activeGroup.expenses = activeGroup.expenses.map(e => {
        if (!e.isArchived) {
            didChange = true;
            return { ...e, isArchived: true };
        }
        return e;
    });

    if (didChange) {
        return saveGroupState(activeGroup);
    }
}

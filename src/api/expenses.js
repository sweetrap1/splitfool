// Expenses API
import { getActiveGroup } from '../state.js';
import { saveGroupState } from './groups.js';

export async function addExpense(expenseData) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;
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

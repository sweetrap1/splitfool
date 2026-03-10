// People API
import { db } from '../firebase-init.js';
import { getActiveGroup } from '../state.js';
import { saveGroupState } from './groups.js';

export async function addPerson(name, venmo) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id || activeGroup.id === 'loading') return;

    const newPerson = {
        id: crypto.randomUUID(),
        name: name,
        venmoUsername: venmo || '',
        userId: null // Explicitly identify this as unclaimed
    };

    activeGroup.people.push(newPerson);
    return saveGroupState(activeGroup);
}

export async function removePerson(id) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    // Check if this person is involved in any expense.
    // Uses `e.participants` (the canonical field) and also handles legacy
    // `e.paidFor` and `e.payers` for backwards compatibility.
    const involved = activeGroup.expenses.some(exp => {
        const inParticipants = (exp.participants || []).some(p => p.personId === id);
        const inPaidFor = (exp.paidFor || []).some(pf => pf.personId === id && pf.included);
        const inPayers = (exp.payers || []).some(p => p.personId === id);
        const isLegacyPayer = exp.paidBy === id || exp.payerId === id;
        return inParticipants || inPaidFor || inPayers || isLegacyPayer;
    });

    if (involved) {
        throw new Error('Cannot delete. This person is involved in an expense.');
    }

    activeGroup.people = activeGroup.people.filter(p => p.id !== id);
    return saveGroupState(activeGroup);
}

export async function editPerson(id, newName, newVenmo) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === id);
    if (person) {
        person.name = newName;
        person.venmoUsername = newVenmo || '';
        return saveGroupState(activeGroup);
    }
}

export async function claimPerson(personId, userId, photoURL) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === personId);
    if (person && !person.userId) {
        person.userId = userId;
        if (photoURL) person.photoURL = photoURL;
        // Keep memberIds in sync
        if (!activeGroup.memberIds) activeGroup.memberIds = [];
        if (!activeGroup.memberIds.includes(userId)) {
            activeGroup.memberIds.push(userId);
        }
        return saveGroupState(activeGroup);
    }
}

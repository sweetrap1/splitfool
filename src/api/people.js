// People API
import { db } from '../firebase-init.js';
import { getActiveGroup } from '../state.js';
import { saveGroupState } from './groups.js';

export async function addPerson(name, venmo) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id || activeGroup.id === 'loading') return;

    const newPerson = {
        id: 'p_' + Date.now(),
        name: name,
        venmoUsername: venmo || '',
        userId: null // Explicitly identify this as unclaimed
    };

    activeGroup.people.push(newPerson);
    // Realtime listener will handle DOM update
    return saveGroupState(activeGroup);
}

export async function removePerson(id) {
    const activeGroup = getActiveGroup();
    if (!activeGroup.id) return;

    // Optional Check: Is person involved in an expense?
    const involved = activeGroup.expenses.some(exp =>
        (exp.payerMode === 'multiple' && exp.payers && exp.payers.some(p => p.personId === id)) ||
        (exp.paidBy === id) ||
        (exp.paidFor.some(pf => pf.personId === id && pf.included))
    );

    if (involved) {
        throw new Error("Cannot delete. This person is involved in an expense.");
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

export async function claimPerson(personId, userId) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === personId);
    if (person && !person.userId) {
        person.userId = userId;
        return saveGroupState(activeGroup);
    }
}

// Auth API and Logic
import { auth, db, provider } from '../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds, myUserId } from '../state.js';
import { subscribeToGroup } from './groups.js';

export async function loginWithPopup() {
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    return auth.signInWithPopup(provider);
}

export function loginWithRedirect() {
    return auth.signInWithRedirect(provider);
}

export function logout() {
    return auth.signOut();
}

export async function joinGroupWithCode(code, user) {
    if (savedGroupIds.includes(code)) {
        return code;
    }

    const docRef = await db.collection('groups').doc(code).get();
    if (docRef.exists) {
        savedGroupIds.push(code);
        saveSavedGroupIds();
        await subscribeToGroup(code);
        return code;
    } else {
        throw new Error("Trip code not found.");
    }
}

export async function handlePendingInvite(user) {
    // This logic relies on UI for claiming, so we pass it back up
    const pendingCode = localStorage.getItem('splitfool_pending_invite');
    if (!pendingCode || !user) return null;

    localStorage.removeItem('splitfool_pending_invite');
    window.history.replaceState({}, document.title, window.location.pathname);

    const docRef = await db.collection('groups').doc(pendingCode).get();
    if (!docRef.exists) {
        throw new Error(`Invite link invalid: Trip '${pendingCode}' was not found.`);
    }

    const groupData = docRef.data();
    return { pendingCode, groupData };
}

export async function claimPersonForInvite(groupId, personId, user) {
    await db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(groupId);
        const doc = await t.get(ref);
        if (!doc.exists) throw new Error("Group does not exist.");

        let groupData = doc.data();
        let pIndex = groupData.people.findIndex(p => p.id === personId);
        if (pIndex !== -1) {
            if (groupData.people[pIndex].userId) {
                throw new Error("This profile is already claimed.");
            }
            groupData.people[pIndex].userId = user.uid;
            t.update(ref, { people: groupData.people });
        }
    });
}

export async function joinNewPersonToGroup(groupId, name, venmo, userId) {
    const id = 'p_' + Date.now();
    const newPerson = {
        id,
        name,
        venmoUsername: venmo,
        userId: userId
    };

    await db.collection('groups').doc(groupId).update({
        people: window.firebase.firestore.FieldValue.arrayUnion(newPerson)
    });
}

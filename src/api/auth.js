// Auth API and Logic
import { auth, db, provider } from '../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds } from '../state.js';
import { subscribeToGroup, addMemberToGroup } from './groups.js';

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

/**
 * Verify a group join code exists in Firestore, then subscribe to it.
 * Requires the caller to already be authenticated (Firestore rules enforce this).
 */
export async function joinGroupWithCode(code) {
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
        throw new Error('Trip code not found.');
    }
}

/**
 * Atomically claim an unclaimed person slot for the given user.
 * Also adds the user's UID to the flat memberIds array so Firestore
 * rules permit future writes.
 */
export async function claimPersonForInvite(groupId, personId, user) {
    await db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(groupId);
        const doc = await t.get(ref);
        if (!doc.exists) throw new Error('Group does not exist.');

        let groupData = doc.data();
        let pIndex = groupData.people.findIndex(p => p.id === personId);
        if (pIndex !== -1) {
            if (groupData.people[pIndex].userId) {
                throw new Error('This profile is already claimed.');
            }
            groupData.people[pIndex].userId = user.uid;

            // Ensure memberIds exists and add the new uid atomically
            const existingMemberIds = groupData.memberIds || groupData.people.filter(p => p.userId).map(p => p.userId);
            if (!existingMemberIds.includes(user.uid)) {
                existingMemberIds.push(user.uid);
            }

            t.update(ref, {
                people: groupData.people,
                memberIds: existingMemberIds
            });
        }
    });
}

export async function joinNewPersonToGroup(groupId, name, venmo, userId) {
    const newPerson = {
        id: crypto.randomUUID(),
        name,
        venmoUsername: venmo,
        userId: userId
    };

    // Update people array and add to the flat memberIds for Firestore rule checks
    await db.collection('groups').doc(groupId).update({
        people: window.firebase.firestore.FieldValue.arrayUnion(newPerson),
        memberIds: window.firebase.firestore.FieldValue.arrayUnion(userId)
    });
}

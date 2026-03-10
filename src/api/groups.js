// Groups API
import { db } from '../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds, setActiveGroup } from '../state.js';
import { generateRoomCode } from '../utils/helpers.js';

let unsubscribeListeners = {};
let userGroupsUnsubscribe = null;

export let onStateChanged = () => { };
export function registerRenderCallback(cb) {
    onStateChanged = cb;
}

export async function createNewGroup(name, options = {}) {
    const roomCode = generateRoomCode();
    const creatorUid = state.currentUser ? state.currentUser.uid : state.myUserId;

    const newGroup = {
        id: roomCode,
        name: name,
        people: [{
            id: crypto.randomUUID(),
            name: state.currentUser ? state.currentUser.displayName : 'Anonymous',
            userId: creatorUid,
            venmoUsername: ''
        }],
        expenses: [],
        creatorId: creatorUid,
        creatorName: state.currentUser ? state.currentUser.displayName : 'Anonymous',
        creatorEmail: state.currentUser ? state.currentUser.email : null,
        // memberIds is a flat array of UIDs — used by Firestore rules to check
        // membership without iterating the people array (rules can't do that).
        memberIds: [creatorUid],
        defaultCurrency: options?.defaultCurrency || 'USD',
        settleCurrency: options?.settleCurrency || 'USD',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('groups').doc(roomCode).set(newGroup);
    savedGroupIds.push(roomCode);
    saveSavedGroupIds();
    setActiveGroup(roomCode);
    return subscribeToGroup(roomCode);
}

export function subscribeToGroup(groupId) {
    return new Promise((resolve) => {
        if (unsubscribeListeners[groupId]) return resolve();

        const unsubscribe = db.collection('groups').doc(groupId).onSnapshot(
            doc => {
                if (doc.exists) {
                    const groupData = doc.data();
                    const existingIndex = state.groups.findIndex(g => g.id === groupId);
                    if (existingIndex >= 0) {
                        state.groups[existingIndex] = groupData;
                    } else {
                        state.groups.push(groupData);
                    }
                    onStateChanged();
                    resolve();
                } else {
                    // Document deleted
                    state.groups = state.groups.filter(g => g.id !== groupId);
                    if (state.activeGroupId === groupId) {
                        setActiveGroup(state.groups.length > 0 ? state.groups[0].id : null);
                    }
                    unsubscribe();
                    delete unsubscribeListeners[groupId];
                    onStateChanged();
                    resolve();
                }
            },
            error => {
                console.error(`Error subscribing to group ${groupId}:`, error);
                resolve();
            }
        );
        unsubscribeListeners[groupId] = unsubscribe;
    });
}

export async function syncUserGroups(uid) {
    if (userGroupsUnsubscribe) {
        userGroupsUnsubscribe();
        userGroupsUnsubscribe = null;
    }

    if (!uid) return;

    // Query on memberIds instead of creatorId so joined groups are also recovered.
    // This requires a Firestore composite index: memberIds (array-contains) + createdAt.
    userGroupsUnsubscribe = db.collection('groups')
        .where('memberIds', 'array-contains', uid)
        .onSnapshot(snapshot => {
            let addedCount = 0;
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    const docId = change.doc.id;
                    if (!savedGroupIds.includes(docId)) {
                        savedGroupIds.push(docId);
                        addedCount++;
                        subscribeToGroup(docId);
                    }
                }
            });

            if (addedCount > 0) {
                saveSavedGroupIds();
                onStateChanged();
            }
        });
}

export async function updateGroup(groupId, newName, options = {}) {
    const updateData = { name: newName };
    if (options.defaultCurrency) updateData.defaultCurrency = options.defaultCurrency;
    if (options.settleCurrency) updateData.settleCurrency = options.settleCurrency;

    await db.collection('groups').doc(groupId).update(updateData);
}

export async function deleteGroup(groupId) {
    await db.collection('groups').doc(groupId).delete();

    const index = savedGroupIds.indexOf(groupId);
    if (index > -1) {
        savedGroupIds.splice(index, 1);
        saveSavedGroupIds();
    }
}

export async function saveGroupState(activeGroup) {
    if (activeGroup && activeGroup.id && activeGroup.id !== 'loading' && activeGroup.id !== 'offline_error' && activeGroup.id !== 'no_groups') {
        if (!activeGroup.creatorId) {
            if (state.currentUser) {
                activeGroup.creatorId = state.currentUser.uid;
                activeGroup.creatorName = state.currentUser.displayName;
                activeGroup.creatorEmail = state.currentUser.email;
            } else {
                activeGroup.creatorId = state.myUserId;
                activeGroup.creatorName = 'Anonymous';
            }
        }

        // Ensure memberIds always exists (migration safety for old groups)
        if (!activeGroup.memberIds) {
            activeGroup.memberIds = activeGroup.people
                .filter(p => p.userId)
                .map(p => p.userId);
        }

        return db.runTransaction(async (transaction) => {
            const groupRef = db.collection('groups').doc(activeGroup.id);
            const doc = await transaction.get(groupRef);

            if (!doc.exists) {
                transaction.set(groupRef, activeGroup);
                return;
            }
            transaction.update(groupRef, activeGroup);
        }).catch(err => console.error('Transaction failed: ', err));
    }
}

/**
 * Adds a UID to the group's flat memberIds array (used by Firestore rules).
 * Must be called whenever a user joins a group via invite.
 */
export async function addMemberToGroup(groupId, uid) {
    await db.collection('groups').doc(groupId).update({
        memberIds: firebase.firestore.FieldValue.arrayUnion(uid)
    });
}

export async function leaveGroup(groupId, uid) {
    if (!groupId || !uid) return;

    // Use a transaction to safely remove the user from people/memberIds
    await db.runTransaction(async (transaction) => {
        const ref = db.collection('groups').doc(groupId);
        const doc = await transaction.get(ref);
        if (!doc.exists) return;

        const data = doc.data();
        const updatedPeople = (data.people || []).filter(p => p.userId !== uid);
        const updatedMemberIds = (data.memberIds || []).filter(id => id !== uid);

        transaction.update(ref, {
            people: updatedPeople,
            memberIds: updatedMemberIds
        });
    });

    // Remove from local known list
    const index = savedGroupIds.indexOf(groupId);
    if (index > -1) {
        savedGroupIds.splice(index, 1);
        saveSavedGroupIds();
    }
}

export async function updateGroupLock(groupId, isLocked) {
    if (!groupId || groupId === 'no_groups') return;
    try {
        await db.collection('groups').doc(groupId).update({ isLocked: isLocked });
    } catch (e) {
        console.error('Failed to update group lock:', e);
        throw e;
    }
}

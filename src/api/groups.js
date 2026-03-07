// Groups API
import { db } from '../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds, myUserId, currentUser, setActiveGroup } from '../state.js';
import { generateRoomCode } from '../utils/helpers.js';

let unsubscribeListeners = {};
let userGroupsUnsubscribe = null;

// The UI module will inject the renderAll function here or listen to events
export let onStateChanged = () => { };
export function registerRenderCallback(cb) {
    onStateChanged = cb;
}

export async function createNewGroup(name, options = {}) {
    const roomCode = generateRoomCode();
    const newGroup = {
        id: roomCode,
        name: name,
        people: [{
            id: 'p_' + Date.now(),
            name: currentUser ? currentUser.displayName : 'Anonymous',
            userId: currentUser ? currentUser.uid : myUserId,
            venmoUsername: ''
        }],
        expenses: [],
        creatorId: currentUser ? currentUser.uid : myUserId,
        creatorName: currentUser ? currentUser.displayName : 'Anonymous',
        creatorEmail: currentUser ? currentUser.email : null,
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
                    resolve(); // Resolve on first success
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

    userGroupsUnsubscribe = db.collection('groups')
        .where('creatorId', '==', uid)
        .onSnapshot(snapshot => {
            let addedCount = 0;
            snapshot.docChanges().forEach(change => {
                if (change.type === "added" || change.type === "modified") {
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

    // Remove from local known list immediately for snappier UI
    const index = savedGroupIds.indexOf(groupId);
    if (index > -1) {
        savedGroupIds.splice(index, 1);
        saveSavedGroupIds();
    }
}

export async function saveGroupState(activeGroup) {
    if (activeGroup && activeGroup.id && activeGroup.id !== 'loading' && activeGroup.id !== 'offline_error' && activeGroup.id !== 'no_groups') {
        if (!activeGroup.creatorId) {
            if (currentUser) {
                activeGroup.creatorId = currentUser.uid;
                activeGroup.creatorName = currentUser.displayName;
                activeGroup.creatorEmail = currentUser.email;
            } else {
                activeGroup.creatorId = myUserId;
                activeGroup.creatorName = 'Anonymous';
            }
        }

        db.runTransaction(async (transaction) => {
            const groupRef = db.collection('groups').doc(activeGroup.id);
            const doc = await transaction.get(groupRef);

            if (!doc.exists) {
                transaction.set(groupRef, activeGroup);
                return;
            }
            transaction.update(groupRef, activeGroup);
        }).catch(err => console.error("Transaction failed: ", err));
    }
}

export async function updateGroupLock(groupId, isLocked) {
    if (!groupId || groupId === 'no_groups') return;
    try {
        await db.collection('groups').doc(groupId).update({ isLocked: isLocked });
    } catch (e) {
        console.error("Failed to update group lock:", e);
        throw e;
    }
}

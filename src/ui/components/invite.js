// Invite UI Component
import { db } from '../../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds, setActiveGroup } from '../../state.js';
import { subscribeToGroup } from '../../api/groups.js';
import { claimPersonForInvite } from '../../api/auth.js';
import { escapeHTML } from '../../utils/helpers.js';
import { showAlert } from '../../utils/dialogs.js';

export async function processPendingInvite(user, renderAll) {
    const pendingCode = localStorage.getItem('splitfool_pending_invite');
    if (!pendingCode || !user) return;

    // Immediately clear to prevent loops
    localStorage.removeItem('splitfool_pending_invite');
    window.history.replaceState({}, document.title, window.location.pathname);

    return handleInviteFlow(pendingCode, user, renderAll);
}

export async function handleInviteFlow(groupId, user, renderAll) {
    if (!groupId || !user) return;

    try {
        const docRef = await db.collection('groups').doc(groupId).get();
        if (!docRef.exists) {
            showAlert('Invalid Invite', `Invite link invalid: Trip '${groupId}' was not found.`, { icon: 'fa-circle-exclamation' });
            return;
        }

        const groupData = docRef.data();

        // 1. Already a member — join silently
        const alreadyClaimed = groupData.people.some(p => p.userId === user.uid);
        if (alreadyClaimed) {
            await finalizeJoin(groupId, user.uid, renderAll);
            return;
        }

        // 2. Empty group — auto-add as new person
        if (!groupData.people || groupData.people.length === 0) {
            const newPerson = {
                id: crypto.randomUUID(),
                name: user.displayName || 'Anonymous',
                venmoUsername: '',
                userId: user.uid,
                photoURL: user.photoURL || null
            };
            await db.collection('groups').doc(groupId).update({
                people: window.firebase.firestore.FieldValue.arrayUnion(newPerson),
                memberIds: window.firebase.firestore.FieldValue.arrayUnion(user.uid)
            });
            await finalizeJoin(groupId, user.uid, renderAll);
            return;
        }

        // 3. Auto-match by display name
        const userName = user.displayName ? user.displayName.toLowerCase().trim() : '';
        const unclaimedMatch = groupData.people.find(
            p => !p.userId && p.name.toLowerCase().trim() === userName
        );

        if (unclaimedMatch) {
            await claimPersonForInvite(groupId, unclaimedMatch.id, user, user.photoURL);
            await finalizeJoin(groupId, user.uid, renderAll);
            return;
        }

        // 4. Prompt user to pick a spot or join fresh
        const unclaimedPeople = groupData.people.filter(p => !p.userId);
        if (unclaimedPeople.length > 0) {
            showClaimModal(groupId, groupData, user, unclaimedPeople, renderAll);
        } else {
            showWelcomeJoinModal(groupId, groupData, user, renderAll);
        }
    } catch (e) {
        console.error('Error handling invite flow:', e);
    }
}

async function finalizeJoin(groupId, uid, renderAll) {
    if (!savedGroupIds.includes(groupId)) {
        savedGroupIds.push(groupId);
        saveSavedGroupIds();
    }
    setActiveGroup(groupId);
    await subscribeToGroup(groupId);
    renderAll();
}

function showClaimModal(groupId, groupData, user, unclaimedPeople, renderAll) {
    const modal = document.getElementById('invite-claim-modal');
    if (!modal) return;

    const groupNameEl = document.getElementById('invite-claim-group-name');
    if (groupNameEl) groupNameEl.textContent = groupData.name;

    const listContainer = document.getElementById('invite-claim-people-list');
    if (!listContainer) return;

    listContainer.innerHTML = unclaimedPeople.map(p => {
        const char = p.name ? p.name.charAt(0).toUpperCase() : '?';
        return `
            <div class="invite-person-card" data-id="${p.id}">
                <div class="avatar">${char}</div>
                <div class="invite-person-name">${escapeHTML(p.name)}</div>
                <div class="invite-check"><i class="fa-solid fa-check"></i></div>
            </div>
        `;
    }).join('');

    let selectedCardId = null;
    const cards = listContainer.querySelectorAll('.invite-person-card');
    const confirmBtn = document.getElementById('invite-claim-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCardId = card.dataset.id;
            if (confirmBtn) confirmBtn.disabled = false;
        });
    });

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            if (!selectedCardId) return;
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Claiming...';

            try {
                await claimPersonForInvite(groupId, selectedCardId, user);
                await finalizeJoin(groupId, user.uid, renderAll);
                modal.classList.remove('active');
            } catch (e) {
                showAlert('Error', 'Error claiming profile: ' + e.message, { icon: 'fa-circle-exclamation' });
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-hand"></i> Claim This Spot';
            }
        };
    }

    const joinNewBtn = document.getElementById('invite-join-as-new-btn');
    if (joinNewBtn) {
        joinNewBtn.onclick = () => {
            modal.classList.remove('active');
            showWelcomeJoinModal(groupId, groupData, user, renderAll);
        };
    }

    modal.classList.add('active');
}

function showWelcomeJoinModal(groupId, groupData, user, renderAll) {
    const modal = document.getElementById('invite-join-modal');
    if (!modal) return;

    const groupNameEl = document.getElementById('invite-join-group-name');
    if (groupNameEl) groupNameEl.textContent = groupData.name;

    const nameInput = document.getElementById('invite-join-name');
    if (nameInput) nameInput.value = user.displayName || '';

    const venmoInput = document.getElementById('invite-join-venmo');
    if (venmoInput) venmoInput.value = '';

    const confirmBtn = document.getElementById('invite-join-confirm-btn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            const name = nameInput ? nameInput.value.trim() : '';
            if (!name) {
                showAlert('Name Required', 'Please enter your name.', { icon: 'fa-user-tag' });
                return;
            }

            let venmo = venmoInput ? venmoInput.value.trim() : '';
            if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;

            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Joining...';

            try {
                const newPerson = {
                    id: crypto.randomUUID(),
                    name,
                    venmoUsername: venmo,
                    userId: user.uid,
                    photoURL: user.photoURL || null
                };

                await db.collection('groups').doc(groupId).update({
                    people: window.firebase.firestore.FieldValue.arrayUnion(newPerson),
                    memberIds: window.firebase.firestore.FieldValue.arrayUnion(user.uid)
                });

                await finalizeJoin(groupId, user.uid, renderAll);
                modal.classList.remove('active');
            } catch (e) {
                console.error(e);
                showAlert('Error', 'Error joining group: ' + e.message, { icon: 'fa-circle-exclamation' });
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Join Trip';
            }
        };
    }

    modal.classList.add('active');
}

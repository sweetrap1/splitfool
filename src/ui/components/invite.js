// Invite UI Component
import { db } from '../../firebase-init.js';
import { state, savedGroupIds, saveSavedGroupIds, setActiveGroup } from '../../state.js';
import { subscribeToGroup } from '../../api/groups.js';
import { claimPersonForInvite } from '../../api/auth.js';
import { escapeHTML } from '../../utils/helpers.js';

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
            alert(`Invite link invalid: Trip '${groupId}' was not found.`);
            return;
        }

        const groupData = docRef.data();

        // 1. If user already claimed someone in this group, just join it silently
        const alreadyClaimed = groupData.people.some(p => p.userId === user.uid);
        if (alreadyClaimed) {
            await finalizeJoin(groupId, renderAll);
            return;
        }

        // 2. If no people in the group yet, auto-join as a new person based on Google profile
        if (!groupData.people || groupData.people.length === 0) {
            console.log(`Auto-joining ${user.displayName} to empty group ${groupId}`);
            const id = 'p_' + Date.now();
            const newPerson = {
                id,
                name: user.displayName || 'Anonymous',
                venmoUsername: '',
                userId: user.uid
            };
            await db.collection('groups').doc(groupId).update({
                people: window.firebase.firestore.FieldValue.arrayUnion(newPerson)
            });
            await finalizeJoin(groupId, renderAll);
            return;
        }

        // 3. Auto-match by name if possible
        const userName = user.displayName ? user.displayName.toLowerCase().trim() : '';
        const unclaimedMatch = groupData.people.find(p => !p.userId && p.name.toLowerCase().trim() === userName);

        if (unclaimedMatch) {
            console.log(`Auto-claiming profile for ${user.displayName}`);
            await claimPersonForInvite(groupId, unclaimedMatch.id, user);
            await finalizeJoin(groupId, renderAll);
            return;
        }

        // 4. Modal Fallbacks
        const unclaimedPeople = groupData.people.filter(p => !p.userId);
        if (unclaimedPeople.length > 0) {
            showClaimModal(groupId, groupData, user, unclaimedPeople, renderAll);
        } else {
            showWelcomeJoinModal(groupId, groupData, user, renderAll);
        }
    } catch (e) {
        console.error("Error handling invite flow:", e);
    }
}

async function finalizeJoin(groupId, renderAll) {
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
                await finalizeJoin(groupId, renderAll);
                modal.classList.remove('active');
            } catch (e) {
                alert("Error claiming profile.");
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
                alert("Please enter a name.");
                return;
            }

            let venmo = venmoInput ? venmoInput.value.trim() : '';
            if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;

            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Joining...';

            try {
                const id = 'p_' + Date.now();
                const newPerson = {
                    id,
                    name,
                    venmoUsername: venmo,
                    userId: user.uid
                };

                await db.collection('groups').doc(groupId).update({
                    people: window.firebase.firestore.FieldValue.arrayUnion(newPerson)
                });

                await finalizeJoin(groupId, renderAll);
                modal.classList.remove('active');
            } catch (e) {
                console.error(e);
                alert("Error joining group.");
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Join Trip';
            }
        };
    }

    modal.classList.add('active');
}

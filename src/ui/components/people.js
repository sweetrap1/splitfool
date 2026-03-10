// People UI Component

import { addPerson, removePerson, editPerson, claimPerson } from '../../api/people.js';
import { getActiveGroup, state, isGroupAdmin } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';
import { showConfirm, showAlert } from '../../utils/dialogs.js';
import { calculateBalances } from '../../utils/math.js';

export function initPeopleUI() {
    const addPersonBtn = document.getElementById('add-person-btn');
    const personModal = document.getElementById('person-modal');

    // Make functions global for inline onclicks in HTML (or attach event listeners here)
    window.openEditPersonModal = openEditPersonModal;
    window.removePersonUI = removePersonUI;
    window.claimPersonUI = claimPersonUI;

    if (addPersonBtn && personModal) {
        addPersonBtn.addEventListener('click', () => {
            document.getElementById('person-name').value = '';
            document.getElementById('person-venmo').value = '';
            personModal.classList.add('active');
        });

        document.getElementById('save-person-btn').addEventListener('click', async () => {
            const name = document.getElementById('person-name').value.trim();
            let venmo = document.getElementById('person-venmo').value.trim();

            if (name) {
                // Ensure Venmo handles start with @
                if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;
                await addPerson(name, venmo);
                personModal.classList.remove('active');
            }
        });
    }

    const editPersonModal = document.getElementById('edit-person-modal');
    if (editPersonModal) {
        document.getElementById('save-edit-person-btn').addEventListener('click', async () => {
            const id = document.getElementById('edit-person-id').value;
            const name = document.getElementById('edit-person-name').value.trim();
            let venmo = document.getElementById('edit-person-venmo').value.trim();

            if (name) {
                if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;
                await editPerson(id, name, venmo);
                editPersonModal.classList.remove('active');
            }
        });
    }
}

export function renderPeople() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('people-list');
    if (!list) return;

    if (!activeGroup || !activeGroup.people || activeGroup.people.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                <i class="fa-solid fa-users" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.3; display: block;"></i>
                <div style="font-weight: 600; margin-bottom: 0.4rem; color: var(--text-main);">No people yet</div>
                <div style="font-size: 0.85rem;">Add the people splitting expenses with you.</div>
            </div>
        `;
        return;
    }

    const isAdmin = isGroupAdmin(activeGroup);

    list.innerHTML = activeGroup.people.map(p => {
        const char = p.name ? p.name.charAt(0).toUpperCase() : '?';
        const isMe = state.currentUser && p.userId === state.currentUser.uid;

        let badgesHtml = '';
        if (isAdmin) {
            // Admins always see clear claimed/unclaimed status for every member
            if (isMe) {
                badgesHtml = `<span class="me-badge">You</span>`;
            } else if (p.userId) {
                badgesHtml = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; font-weight:700; color: var(--success); background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 20px; padding: 2px 9px; letter-spacing: 0.3px;"><i class="fa-solid fa-link" style="font-size:0.65rem;"></i> Linked</span>`;
            } else {
                badgesHtml = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; font-weight:700; color: var(--text-muted); background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.15); border-radius: 20px; padding: 2px 9px; letter-spacing: 0.3px;"><i class="fa-solid fa-link-slash" style="font-size:0.65rem;"></i> Unlinked</span>`;
            }
        } else if (state.currentUser && !p.userId) {
            const alreadyClaimedSomeone = activeGroup.people.some(person => person.userId === state.currentUser.uid);
            if (!alreadyClaimedSomeone) {
                badgesHtml = `<button class="btn sm" style="padding: 2px 8px; font-size: 0.7rem; height: auto;" onclick="claimPersonUI('${p.id}')"><i class="fa-solid fa-hand"></i> Claim</button>`;
            }
        } else if (p.userId) {
            if (isMe) {
                badgesHtml = `<span class="me-badge">You</span>`;
            } else {
                badgesHtml = `<span class="claim-badge">Claimed</span>`;
            }
        }

        const venmoBadge = p.venmoUsername ? `<div class="venmo-badge"><i class="fa-brands fa-venmo"></i> ${escapeHTML(p.venmoUsername)}</div>` : '';

        const canEdit = isAdmin || isMe;
        let controlsHtml = '';
        if (canEdit) {
            controlsHtml += `<button class="btn icon-btn sm" onclick="openEditPersonModal('${p.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>`;
        }
        if (isAdmin) {
            controlsHtml += `<button class="btn danger sm icon-btn" onclick="removePersonUI('${p.id}')" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
        }

        return `
            <div class="card person-card">
                <div class="person-info-container">
                    <div class="avatar">${char}</div>
                    <div class="person-details">
                        <div class="person-name-row">
                            <span class="person-name">${escapeHTML(p.name)}</span>
                            <div class="badge-container">${badgesHtml}</div>
                        </div>
                        ${venmoBadge}
                    </div>
                </div>
                <div class="person-actions">
                    ${controlsHtml}
                </div>
            </div>
        `;
    }).join('');
}

function openEditPersonModal(id) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === id);
    if (person) {
        document.getElementById('edit-person-id').value = person.id;
        document.getElementById('edit-person-name').value = person.name;
        document.getElementById('edit-person-venmo').value = person.venmoUsername || '';
        document.getElementById('edit-person-modal').classList.add('active');
    }
}

async function removePersonUI(id) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === id);
    const personName = person?.name || 'This person';

    // Balance guard — block removal if they have outstanding debts
    const balances = calculateBalances(activeGroup);
    const personBals = balances[id] || {};
    const outstanding = Object.entries(personBals).filter(([, amt]) => Math.abs(amt) > 0.01);
    if (outstanding.length > 0) {
        const lines = outstanding.map(([cur, amt]) => {
            const prefix = amt > 0 ? 'is owed' : 'owes';
            return `${personName} ${prefix} ${Math.abs(amt).toFixed(2)} ${cur}`;
        }).join('\n');
        showAlert(
            'Outstanding Balance',
            `Cannot remove ${personName} — they still have unpaid balances:\n\n${lines}\n\nSettle all debts first.`,
            { icon: 'fa-circle-exclamation' }
        );
        return;
    }

    const confirmed = await showConfirm('Remove Person', `Remove ${escapeHTML(personName)} from the group?`, {
        danger: true,
        confirmText: 'Remove',
        icon: 'fa-user-minus'
    });

    if (confirmed) {
        try {
            await removePerson(id);
        } catch (e) {
            showAlert('Error', e.message, { icon: 'fa-circle-exclamation' });
        }
    }
}

async function claimPersonUI(id) {
    const confirmed = await showConfirm("Claim Profile", "Claim this profile as yours?", {
        confirmText: 'Claim Spot',
        icon: 'fa-hand'
    });

    if (confirmed) {
        await claimPerson(id, state.currentUser.uid);
    }
}

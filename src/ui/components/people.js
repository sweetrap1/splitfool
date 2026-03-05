// People UI Component

import { addPerson, removePerson, editPerson, claimPerson } from '../../api/people.js';
import { getActiveGroup, currentUser, isGroupAdmin } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';

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
        list.innerHTML = '<div class="empty-state">No people added yet. Add someone to start splitting!</div>';
        return;
    }

    const isAdmin = isGroupAdmin(activeGroup);

    list.innerHTML = activeGroup.people.map(p => {
        const char = p.name ? p.name.charAt(0).toUpperCase() : '?';
        const isMe = currentUser && p.userId === currentUser.uid;

        let badgesHtml = '';
        if (currentUser && !p.userId) {
            const alreadyClaimedSomeone = activeGroup.people.some(person => person.userId === currentUser.uid);
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

        const isAdmin = isGroupAdmin(activeGroup);
        const canEdit = isAdmin || isMe;
        let controlsHtml = '';
        if (canEdit) {
            controlsHtml += `<button class="btn icon-btn sm" onclick="openEditPersonModal('${p.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>`;
        }
        if (isAdmin) {
            controlsHtml += `<button class="btn danger sm icon-btn" onclick="removePersonUI('${p.id}')" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
        }

        return `
            <div class="card person-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.75rem; padding: 0.75rem 1rem; min-height: 85px;">
                <div class="person-info" style="display:flex; align-items:center; gap: 1rem; flex: 1; min-width: 0;">
                    <div class="avatar" style="width: 48px; height: 48px; font-size: 1.2rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">${char}</div>
                    <div style="display:flex; flex-direction:column; justify-content: center; gap: 4px; min-width: 0; flex: 1;">
                        <div style="display:flex; align-items:center; gap: 8px; flex-wrap: nowrap; min-width: 0;">
                            <span style="font-weight: 700; font-size: 1.1rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1;">${escapeHTML(p.name)}</span>
                            <div style="flex-shrink: 0; display: flex; gap: 4px;">${badgesHtml}</div>
                        </div>
                        ${venmoBadge}
                    </div>
                </div>
                <div class="person-actions" style="display:flex; gap: 0.5rem; flex-shrink: 0; align-items: center; margin-left: 1rem;">
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
    if (confirm('Are you sure you want to remove this person?')) {
        try {
            await removePerson(id);
        } catch (e) {
            alert(e.message);
        }
    }
}

async function claimPersonUI(id) {
    if (confirm("Claim this profile as yours?")) {
        await claimPerson(id, currentUser.uid);
    }
}

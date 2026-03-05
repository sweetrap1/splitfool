// Groups UI Component

import { createNewGroup, updateGroup, deleteGroup } from '../../api/groups.js';
import { getActiveGroup, isGroupAdmin, state } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';

export function initGroupsUI(renderAll) {
    const groupSelect = document.getElementById('active-group-select');
    if (groupSelect) {
        groupSelect.addEventListener('change', (e) => {
            import('../../state.js').then(({ setActiveGroup }) => {
                setActiveGroup(e.target.value);
                renderAll();
            });
        });
    }

    const addGroupModal = document.getElementById('group-modal');
    if (addGroupModal) {
        document.getElementById('add-group-btn').addEventListener('click', () => {
            document.getElementById('group-name').value = '';
            addGroupModal.classList.add('active');
        });

        document.getElementById('save-group-btn').addEventListener('click', async () => {
            const nameInput = document.getElementById('group-name').value.trim();
            if (nameInput) {
                await createNewGroup(nameInput);
                addGroupModal.classList.remove('active');
            }
        });
    }

    const editGroupBtn = document.getElementById('edit-group-btn');
    const editGroupModal = document.getElementById('edit-group-modal');
    if (editGroupBtn && editGroupModal) {
        editGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            if (!isGroupAdmin(activeGroup)) {
                alert("Only the group creator can rename this trip.");
                return;
            }

            document.getElementById('edit-group-name').value = activeGroup.name;
            editGroupModal.classList.add('active');
        });

        document.getElementById('save-edit-group-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            const newName = document.getElementById('edit-group-name').value.trim();
            if (newName && newName !== "") {
                await updateGroup(activeGroup.id, newName);
                editGroupModal.classList.remove('active');
            }
        });
    }

    const deleteGroupBtn = document.getElementById('delete-group-btn');
    const deleteGroupModal = document.getElementById('delete-confirm-modal');
    if (deleteGroupBtn && deleteGroupModal) {
        deleteGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            if (!isGroupAdmin(activeGroup)) {
                alert("Only the group creator can delete this trip.");
                return;
            }

            if (state.groups.length <= 1) {
                alert("You cannot delete the only remaining group.");
                return;
            }
            const safeGroupName = escapeHTML(activeGroup.name);
            document.getElementById('delete-confirm-message').innerHTML = `Are you sure you want to delete the group <strong>"${safeGroupName}"</strong>?`;
            deleteGroupModal.classList.add('active');
        });

        document.getElementById('confirm-delete-group-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            await deleteGroup(activeGroup.id);
            deleteGroupModal.classList.remove('active');
        });
    }

    // Share Group
    const shareBtn = document.getElementById('share-group-btn');
    const shareModal = document.getElementById('share-group-modal');
    if (shareBtn && shareModal) {
        shareBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            if (!activeGroup.id || activeGroup.id === 'loading') return;

            const codeDisplay = document.getElementById('share-group-code-display');
            const linkDisplay = document.getElementById('share-group-link-display');

            if (codeDisplay) codeDisplay.textContent = activeGroup.id;
            if (linkDisplay) {
                const url = new URL(window.location.href);
                url.searchParams.set('join', activeGroup.id);
                linkDisplay.value = url.toString();
            }

            shareModal.classList.add('active');
        });

        document.getElementById('copy-share-link-btn')?.addEventListener('click', () => {
            const linkInput = document.getElementById('share-group-link-display');
            if (linkInput) {
                linkInput.select();
                document.execCommand('copy');
                const btn = document.getElementById('copy-share-link-btn');
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => btn.innerHTML = original, 2000);
            }
        });
    }

    // Join Group
    const joinBtn = document.getElementById('join-group-btn');
    const joinModal = document.getElementById('join-group-modal');
    if (joinBtn && joinModal) {
        joinBtn.addEventListener('click', () => {
            document.getElementById('join-group-code').value = '';
            joinModal.classList.add('active');
        });

        document.getElementById('confirm-join-group-btn')?.addEventListener('click', async () => {
            const codeInput = document.getElementById('join-group-code');
            const code = codeInput.value.trim().toUpperCase();
            if (!code) return;

            const btn = document.getElementById('confirm-join-group-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';

            try {
                if (state.currentUser) {
                    const { handleInviteFlow } = await import('./invite.js');
                    await handleInviteFlow(code, state.currentUser, renderAll);
                } else {
                    const { joinGroupWithCode } = await import('../../api/auth.js');
                    const { setActiveGroup } = await import('../../state.js');
                    await joinGroupWithCode(code, null);
                    setActiveGroup(code);
                    renderAll();
                }
                joinModal.classList.remove('active');
            } catch (e) {
                alert(e.message || "Failed to join trip.");
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Join Trip';
            }
        });
    }
}

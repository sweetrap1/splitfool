// Groups UI Component

import { createNewGroup, updateGroup, deleteGroup, leaveGroup } from '../../api/groups.js';
import { getActiveGroup, isGroupAdmin, state } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';
import { showAlert, showConfirm } from '../../utils/dialogs.js';
import { calculateBalances } from '../../utils/math.js';
import { updateModalBodyClass } from '../navigation.js';

export function initGroupsUI(renderAll) {
    // NOTE: The group selector <change> event is owned by navigation.js
    // (renderGroupSelector) which sets the active group AND resets settle mode.
    // Do NOT attach another change listener here — it would cause double renders.

    const addGroupModal = document.getElementById('group-modal');
    if (addGroupModal) {
        document.getElementById('add-group-btn').addEventListener('click', () => {
            document.getElementById('group-name').value = '';
            document.getElementById('group-default-currency').value = 'USD';
            document.getElementById('group-settle-currency').value = 'USD';
            addGroupModal.classList.add('active');
            updateModalBodyClass();
        });

        document.getElementById('save-group-btn').addEventListener('click', async () => {
            const nameInput = document.getElementById('group-name').value.trim();
            const defaultCur = document.getElementById('group-default-currency').value;
            const settleCur = document.getElementById('group-settle-currency').value;

            if (nameInput) {
                await createNewGroup(nameInput, {
                    defaultCurrency: defaultCur,
                    settleCurrency: settleCur
                });
                addGroupModal.classList.remove('active');
                updateModalBodyClass();
            }
        });
    }

    const editGroupBtn = document.getElementById('edit-group-btn');
    const editGroupModal = document.getElementById('edit-group-modal');
    if (editGroupBtn && editGroupModal) {
        editGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            if (!isGroupAdmin(activeGroup)) {
                showAlert('Access Denied', 'Only the group creator can rename this trip.', { icon: 'fa-circle-exclamation' });
                return;
            }

            document.getElementById('edit-group-name').value = activeGroup.name;
            if (activeGroup.defaultCurrency) {
                document.getElementById('edit-group-default-currency').value = activeGroup.defaultCurrency;
            }
            if (activeGroup.settleCurrency) {
                document.getElementById('edit-group-settle-currency').value = activeGroup.settleCurrency;
            }
            editGroupModal.classList.add('active');
            updateModalBodyClass();
        });

        document.getElementById('save-edit-group-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            const newName = document.getElementById('edit-group-name').value.trim();
            const defaultCur = document.getElementById('edit-group-default-currency').value;
            const settleCur = document.getElementById('edit-group-settle-currency').value;

            if (newName && newName !== '') {
                await updateGroup(activeGroup.id, newName, {
                    defaultCurrency: defaultCur,
                    settleCurrency: settleCur
                });
                editGroupModal.classList.remove('active');
                updateModalBodyClass();
            }
        });
    }

    const deleteGroupBtn = document.getElementById('delete-group-btn');
    const deleteGroupModal = document.getElementById('delete-confirm-modal');
    if (deleteGroupBtn && deleteGroupModal) {
        deleteGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            if (!isGroupAdmin(activeGroup)) {
                showAlert('Access Denied', 'Only the group creator can delete this trip.', { icon: 'fa-circle-exclamation' });
                return;
            }

            if (state.groups.length <= 1) {
                showAlert('Cannot Delete', 'You cannot delete the only remaining group.', { icon: 'fa-triangle-exclamation' });
                return;
            }
            const safeGroupName = escapeHTML(activeGroup.name);
            document.getElementById('delete-confirm-message').innerHTML = `Are you sure you want to delete the trip <strong>"${safeGroupName}"</strong>?`;
            deleteGroupModal.classList.add('active');
            updateModalBodyClass();
        });

        document.getElementById('confirm-delete-group-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            await deleteGroup(activeGroup.id);
            deleteGroupModal.classList.remove('active');
            updateModalBodyClass();
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
            updateModalBodyClass();
        });

        // Use modern Clipboard API instead of deprecated execCommand
        document.getElementById('copy-share-link-btn')?.addEventListener('click', async () => {
            const linkInput = document.getElementById('share-group-link-display');
            if (linkInput) {
                try {
                    await navigator.clipboard.writeText(linkInput.value);
                } catch {
                    // Fallback for older browsers / non-secure contexts
                    linkInput.select();
                    document.execCommand('copy');
                }
                const btn = document.getElementById('copy-share-link-btn');
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => btn.innerHTML = original, 2000);
            }
        });
    }

    // Join Group (authenticated users only — unauthenticated join was removed)
    const joinBtn = document.getElementById('join-group-btn');
    const joinModal = document.getElementById('join-group-modal');
    if (joinBtn && joinModal) {
        joinBtn.addEventListener('click', () => {
            document.getElementById('join-group-code').value = '';
            joinModal.classList.add('active');
            updateModalBodyClass();
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
                    // Must be logged in — prompt them to sign in first
                    showAlert('Sign In Required', 'Please sign in with Google first, then join a trip.', { icon: 'fa-lock' });
                }
                joinModal.classList.remove('active');
                updateModalBodyClass();
            } catch (e) {
                showAlert('Join Error', e.message || 'Failed to join trip.', { icon: 'fa-circle-exclamation' });
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Join Trip';
            }
        });
    }

    // Leave Group
    const leaveBtn = document.getElementById('leave-group-btn');
    const leaveModal = document.getElementById('leave-confirm-modal');
    if (leaveBtn && leaveModal) {
        leaveBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            const safeGroupName = escapeHTML(activeGroup.name);
            document.getElementById('leave-confirm-message').innerHTML = `Are you sure you want to leave the trip <strong>"${safeGroupName}"</strong>?`;
            leaveModal.classList.add('active');
            updateModalBodyClass();
        });

        document.getElementById('confirm-leave-group-btn')?.addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            const uid = state.currentUser ? state.currentUser.uid : state.myUserId;

            // Balance guard — block leaving if this person has outstanding debts
            const myPerson = activeGroup.people.find(p => p.userId === uid);
            if (myPerson) {
                const balances = calculateBalances(activeGroup);
                const myBals = balances[myPerson.id] || {};
                const outstanding = Object.entries(myBals).filter(([, amt]) => Math.abs(amt) > 0.01);
                if (outstanding.length > 0) {
                    const lines = outstanding.map(([cur, amt]) => {
                        const prefix = amt > 0 ? 'you are owed' : 'you owe';
                        return `${prefix} ${Math.abs(amt).toFixed(2)} ${cur}`;
                    }).join('\n');
                    document.getElementById('leave-confirm-modal').classList.remove('active');
                    showAlert(
                        'Outstanding Balance',
                        `You can't leave yet — you still have unpaid balances:\n\n${lines}\n\nSettle up first, then leave.`,
                        { icon: 'fa-circle-exclamation' }
                    );
                    return;
                }
            }

            const btn = document.getElementById('confirm-leave-group-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Leaving...';

            try {
                await leaveGroup(activeGroup.id, uid);
                leaveModal.classList.remove('active');
                updateModalBodyClass();
                renderAll();
            } catch (e) {
                showAlert('Error', e.message || 'Failed to leave trip.', { icon: 'fa-circle-exclamation' });
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Leave Trip';
            }
        });
    }
}

// Navigation and Global UI components
import { state, isGroupAdmin, getActiveGroup, setActiveGroup } from '../state.js';
import { saveGroupState, deleteGroup } from '../api/groups.js';
import { resetSettleModeForGroup } from './components/settleUp.js';

export function initNavigation() {
    // Navigation Logic
    const navItems = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.tab-content');
    const headerTitle = document.getElementById('header-title');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const viewId = item.getAttribute('data-tab');
            views.forEach(view => {
                if (view.id === viewId) {
                    view.classList.add('active');
                } else {
                    view.classList.remove('active');
                }
            });

            if (headerTitle) {
                headerTitle.textContent = item.querySelector('span').textContent;
            }
        });
    });
}

// Global UI Rendering Helpers
export function renderGroupSelector(onGroupChange) {
    const select = document.getElementById('active-group-select');
    if (!select) return;

    // Save current selection to restore if state is empty/loading
    const currentActiveId = state.activeGroupId;

    select.innerHTML = '';
    const sortedGroups = [...state.groups].sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
        return timeB - timeA;
    });

    if (sortedGroups.length === 0) {
        const option = document.createElement('option');
        option.value = 'no_groups';
        option.textContent = 'No Trips Found';
        select.appendChild(option);
        return;
    }

    sortedGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        if (group.id === currentActiveId) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // Final sync: if state says we have an active group that IS in the list,
    // make sure the DOM matches.
    if (currentActiveId && select.value !== currentActiveId) {
        select.value = currentActiveId;
    }

    // Toggle Group Admin vs Member controls
    const activeGroup = getActiveGroup();
    const isAdmin = isGroupAdmin(activeGroup);
    const hasGroups = state.groups.length > 0;

    const editBtn = document.getElementById('edit-group-btn');
    const deleteBtn = document.getElementById('delete-group-btn');
    const leaveBtn = document.getElementById('leave-group-btn');

    if (editBtn) editBtn.style.display = (isAdmin && hasGroups) ? 'inline-flex' : 'none';
    if (deleteBtn) deleteBtn.style.display = (isAdmin && hasGroups) ? 'inline-flex' : 'none';
    if (leaveBtn) leaveBtn.style.display = (!isAdmin && hasGroups && activeGroup.id !== 'no_groups' && activeGroup.id !== 'loading') ? 'inline-flex' : 'none';

    // Reset settle mode when group changes (only attach listener once per element)
    if (!select._groupSwitchListenerAttached) {
        select._groupSwitchListenerAttached = true;
        select.addEventListener('change', (e) => {
            const newGroupId = e.target.value;
            setActiveGroup(newGroupId);
            const newGroup = state.groups.find(g => g.id === newGroupId);
            resetSettleModeForGroup(newGroup);
            if (onGroupChange) onGroupChange();
        });
    }
}

export function initModals() {
    // Basic modal closing logic
    document.querySelectorAll('.close-btn, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
                updateModalBodyClass();
            }
        });
    });
}

// Close on clicking outside the modal content
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
        updateModalBodyClass();
    }
});

// Update body scroll lock based on if ANY modal is active
export function updateModalBodyClass() {
    const activeModal = document.querySelector('.modal.active');
    if (activeModal) {
        document.body.classList.add('modal-open');
    } else {
        document.body.classList.remove('modal-open');
    }
}

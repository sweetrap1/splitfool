// State Management Module

export let state = {
    activeGroupId: null,
    groups: [],
    currentUser: null,
    myUserId: localStorage.getItem('splitfool_user_id')
};

if (!state.myUserId) {
    state.myUserId = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    localStorage.setItem('splitfool_user_id', state.myUserId);
}

// Keep track of our local cache
export let savedGroupIds = JSON.parse(localStorage.getItem('splitfool_saved_groups') || '[]');

export function saveSavedGroupIds() {
    localStorage.setItem('splitfool_saved_groups', JSON.stringify(savedGroupIds));
}

export function setCurrentUser(user) {
    state.currentUser = user;
    if (user) {
        state.myUserId = user.uid;
    } else {
        state.myUserId = localStorage.getItem('splitfool_user_id');
    }
}

export function setActiveGroup(groupId) {
    state.activeGroupId = groupId;
}

export function clearStateForLogout() {
    state.groups = [];
    state.activeGroupId = null;
    savedGroupIds = [];
    localStorage.removeItem('splitfool_saved_groups');
}

export function getActiveGroup() {
    if (state.activeGroupId) {
        const group = state.groups.find(g => g.id === state.activeGroupId);
        if (group) return group;
    }

    // Fallback to newest group if none active or active not found
    if (state.groups.length > 0) {
        const sorted = [...state.groups].sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
            return timeB - timeA;
        });
        return sorted[0];
    }

    // Check if genuinely no groups vs loading
    if (savedGroupIds.length === 0) {
        return { id: 'no_groups', name: 'No Trips - Join or Create one!', people: [], expenses: [], creatorId: null };
    }

    return { id: 'loading', name: 'Loading...', people: [], expenses: [], creatorId: null };
}

export function isGroupAdmin(group) {
    if (!group) return false;
    if (group.id === 'no_groups' || group.id === 'loading') return false;

    // If no creatorId at all (legacy), anyone can admin
    if (!group.creatorId) return true;

    // If logged in, check UID
    if (state.currentUser && group.creatorId === state.currentUser.uid) return true;

    // IMPORTANT: Removing fallback to localStorage user ID for authorization
    // relying on localStorage for admin privileges is an IDOR vulnerability.
    return false;
}

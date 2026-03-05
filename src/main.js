// main.js - Entry Point

import { auth, db } from './firebase-init.js';
import { state, setCurrentUser, savedGroupIds, setActiveGroup } from './state.js';
import { syncUserGroups, registerRenderCallback, subscribeToGroup } from './api/groups.js';
import { fetchExchangeRate } from './utils/currency.js';

// UI Initializers
import { initNavigation, renderGroupSelector, initModals } from './ui/navigation.js';
import { initAuthUI, showAuthStatus } from './ui/components/auth.js';
import { initGroupsUI } from './ui/components/groups.js';
import { initPeopleUI, renderPeople } from './ui/components/people.js';
import { initExpensesUI, renderExpenses } from './ui/components/expenses.js';
import { initSettleUpUI, renderBalances, renderSettleUp } from './ui/components/settleUp.js';

// Global Render Function
function renderAll() {
    renderGroupSelector(renderAll);
    renderPeople();
    renderExpenses();
    renderBalances();
    renderSettleUp();
}

// Bind state changes to re-render
registerRenderCallback(renderAll);

document.addEventListener('DOMContentLoaded', async () => {
    // Process URL Invite Links (?join=CODE) immediately before Auth
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join')?.toUpperCase();

    if (joinCode && joinCode.length >= 6 && joinCode.length <= 8) {
        localStorage.setItem('splitfool_pending_invite', joinCode);
    }

    // Auth state listener
    auth.onAuthStateChanged(user => {
        setCurrentUser(user);
        const loginBtn = document.getElementById('login-btn');
        const userInfo = document.getElementById('user-info');
        const authOverlay = document.getElementById('auth-overlay');
        const appContainer = document.querySelector('.app-container');

        if (user) {
            console.log("Auth state change: User logged in", user.displayName);
            if (loginBtn) loginBtn.classList.add('hidden');
            if (userInfo) {
                userInfo.classList.remove('hidden');
                document.getElementById('user-avatar').src = user.photoURL || 'https://via.placeholder.com/32';
                document.getElementById('user-name').textContent = user.displayName;
            }
            if (authOverlay) authOverlay.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');
            showAuthStatus("Successfully signed in", "success", 2000);

            syncUserGroups(user.uid);

            // Check for pending invite (Claiming/Joining flow)
            import('./ui/components/invite.js').then(({ processPendingInvite }) => {
                processPendingInvite(user, renderAll);
            }).catch(e => console.error("Invite processing error:", e));
        } else {
            console.log("Auth state change: No user");
            syncUserGroups(null);
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (userInfo) userInfo.classList.add('hidden');

            if (authOverlay) authOverlay.classList.remove('hidden');
            if (appContainer) appContainer.classList.add('hidden');
        }
        renderAll();
    });

    try {
        await initFirebaseDataFallback();
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
    }

    console.log("DOM Content Loaded. Initializing Modular Scripts...");

    try {
        initNavigation();
        initModals();
        initAuthUI(renderAll, renderAll);
        initGroupsUI(renderAll);
        initPeopleUI(renderAll);
        initExpensesUI(renderAll);
        initSettleUpUI(renderAll);

        // Initial fetch for currency rates
        fetchExchangeRate(renderAll);

        console.log("Initialization complete.");
    } catch (err) {
        console.error("Critical initialization error:", err);
    }
    renderAll();
});

async function initFirebaseDataFallback() {
    // Basic initialization of known groups if any
    if (savedGroupIds.length > 0) {
        if (!state.activeGroupId) {
            setActiveGroup(savedGroupIds[0]);
        }

        // IMPORTANT: We must subscribe to all previously known groups
        // otherwise they will never load into memory unless the user is the creator
        // and discoverable via syncUserGroups
        // const { subscribeToGroup } = await import('./api/groups.js'); // subscribeToGroup is already imported
        for (const id of savedGroupIds) {
            subscribeToGroup(id);
        }
    }
}

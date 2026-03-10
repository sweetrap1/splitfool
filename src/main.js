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

    // ── Offline / reconnection banner ────────────────────────────────────────
    const offlineBanner = document.createElement('div');
    offlineBanner.id = 'offline-banner';
    offlineBanner.innerHTML = '<i class="fa-solid fa-wifi" style="text-decoration: line-through; margin-right: 6px;"></i> No internet connection — changes will sync when you reconnect.';
    Object.assign(offlineBanner.style, {
        display: 'none', position: 'fixed', top: '0', left: '0', right: '0',
        zIndex: '9999', background: 'rgba(239,68,68,0.92)', color: '#fff',
        textAlign: 'center', padding: '10px 1rem', fontSize: '0.85rem',
        fontWeight: '600', fontFamily: "'Outfit', sans-serif",
        backdropFilter: 'blur(6px)', letterSpacing: '0.2px'
    });
    document.body.prepend(offlineBanner);

    window.addEventListener('offline', () => { offlineBanner.style.display = 'block'; });
    window.addEventListener('online',  () => { offlineBanner.style.display = 'none'; });
    if (!navigator.onLine) offlineBanner.style.display = 'block';

    // ── PWA Installation Logic ───────────────────────────────────────────────
    let deferredPrompt;
    const installBtn = document.getElementById('install-pwa-btn');
    const installLoginBtn = document.getElementById('install-pwa-login-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        if (installBtn) installBtn.style.display = 'inline-flex';
        if (installLoginBtn) installLoginBtn.style.display = 'inline-flex';
        console.log("PWA install prompt is ready.");
    });

    async function handleInstallPrompt() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        
        deferredPrompt = null;
        if (installBtn) installBtn.style.display = 'none';
        if (installLoginBtn) installLoginBtn.style.display = 'none';
    }

    if (installBtn) installBtn.addEventListener('click', handleInstallPrompt);
    if (installLoginBtn) installLoginBtn.addEventListener('click', handleInstallPrompt);
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

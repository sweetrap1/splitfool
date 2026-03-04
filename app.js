// Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyArL1xQgclF0tshvGoZPRmIlCSfzr0TAps",
    authDomain: "splitfool-4ca6b.firebaseapp.com",
    projectId: "splitfool-4ca6b",
    storageBucket: "splitfool-4ca6b.firebasestorage.app",
    messagingSenderId: "544504211257",
    appId: "1:544504211257:web:94d93ff317d28d91ebeae8",
    measurementId: "G-C7HF3N3X7N"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
const db = firebase.firestore();

// State Management
let savedGroupIds = JSON.parse(localStorage.getItem('splitfool_saved_groups') || '[]');
let state = {
    activeGroupId: null,
    groups: []
};
let unsubscribeListeners = {};
let userGroupsUnsubscribe = null;
let currentUser = null;

// Fallback User ID for offline/unauthenticated users
let myUserId = localStorage.getItem('splitfool_user_id');
if (!myUserId) {
    myUserId = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    localStorage.setItem('splitfool_user_id', myUserId);
}

function getActiveGroup() {
    const group = state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
    if (group) return group;

    // Check if genuinely no groups vs loading
    if (savedGroupIds.length === 0) {
        return { id: 'no_groups', name: 'No Trips - Join or Create one!', people: [], expenses: [], creatorId: null };
    }

    return { id: 'loading', name: 'Loading...', people: [], expenses: [], creatorId: null };
}

function isGroupAdmin(group) {
    if (!group) return false;
    if (group.id === 'no_groups' || group.id === 'loading') return false;

    // If no creatorId at all (legacy), anyone can admin
    if (!group.creatorId) return true;

    // If logged in, check UID
    if (currentUser && group.creatorId === currentUser.uid) return true;

    // IMPORTANT: Removing fallback to localStorage user ID for authorization
    // relying on localStorage for admin privileges is an IDOR vulnerability.
    return false;
}

// Utility: Escape HTML to prevent XSS
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Process URL Invite Links (?join=CODE) immediately before Auth
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join')?.toUpperCase();

    if (joinCode && joinCode.length >= 6 && joinCode.length <= 8) {
        localStorage.setItem('splitfool_pending_invite', joinCode);
        // Do NOT clean the URL here, wait until handlePendingInvite finishes, otherwise redirect logins will lose it!
    }

    // Auth state listener
    auth.onAuthStateChanged(user => {
        currentUser = user;
        const loginBtn = document.getElementById('login-btn');
        const userInfo = document.getElementById('user-info');
        const authOverlay = document.getElementById('auth-overlay');
        const appContainer = document.querySelector('.app-container');

        if (user) {
            console.log("Auth state change: User logged in", user.displayName);
            myUserId = user.uid;
            if (loginBtn) loginBtn.classList.add('hidden');
            if (userInfo) {
                userInfo.classList.remove('hidden');
                document.getElementById('user-avatar').src = user.photoURL || 'https://via.placeholder.com/32';
                document.getElementById('user-name').textContent = user.displayName;
            }
            // Gate UI
            if (authOverlay) authOverlay.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');
            showAuthStatus("Successfully signed in", "success", 2000);

            // Sync groups across devices
            syncUserGroups(user.uid);

            // Check for pending invite
            handlePendingInvite(user);
        } else {
            console.log("Auth state change: No user");
            syncUserGroups(null); // Stop listener
            myUserId = localStorage.getItem('splitfool_user_id');
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (userInfo) userInfo.classList.add('hidden');

            if (authOverlay) authOverlay.classList.remove('hidden');
            if (appContainer) appContainer.classList.add('hidden');
        }
        renderAll();
    });

    // Handle Redirect Result for Mobile
    try {
        const result = await auth.getRedirectResult();
        if (result && result.user) {
            console.log("Logged in via redirect:", result.user.displayName);
        }
    } catch (error) {
        console.error("Redirect Login Error:", error);
    }

    try {
        await initFirebaseData();
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        // Fallback so the UI doesn't crash completely
        if (state.groups.length === 0) {
            state.groups = [{ id: 'offline_error', name: 'Offline Error Trip', people: [], expenses: [] }];
            state.activeGroupId = 'offline_error';
        }
    }

    console.log("DOM Content Loaded. Initializing...");

    try {
        initGroups();
        initNavigation();
        initModals();
        initAuth();
        console.log("Initialization complete.");
    } catch (err) {
        console.error("Critical initialization error:", err);
    }
    renderAll();
});

function initAuth() {
    const loginHandler = async () => {
        showAuthStatus("Initializing Google Login...", "");
        const googleBtn = document.getElementById('google-login-btn');
        if (googleBtn) googleBtn.disabled = true;

        console.log("Attempting Popup login (unified strategy)...");
        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            await auth.signInWithPopup(provider);
            console.log("Popup login success.");
        } catch (error) {
            console.warn("Popup blocked or failed. Error code:", error.code);

            if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
                showAuthStatus("Popup blocked. Redirecting...", "");
                console.log("Falling back to Redirect.");
                auth.signInWithRedirect(provider).catch(err => {
                    handleAuthError(err);
                    showAuthStatus("Login failed: " + err.message, "error");
                    if (googleBtn) googleBtn.disabled = false;
                });
            } else {
                handleAuthError(error);
                showAuthStatus("Login error: " + error.message, "error");
                if (googleBtn) googleBtn.disabled = false;
            }
        }
    };

    document.getElementById('login-btn')?.addEventListener('click', loginHandler);
    document.getElementById('google-login-btn')?.addEventListener('click', loginHandler);

    const joinHandler = async () => {
        const codeInput = document.getElementById('login-join-code');
        const code = codeInput.value.trim().toUpperCase();
        if (code && code.length >= 6 && code.length <= 8) {
            if (savedGroupIds.includes(code)) {
                // Just hide overlay and show app
                document.getElementById('auth-overlay')?.classList.add('hidden');
                document.querySelector('.app-container')?.classList.remove('hidden');
                state.activeGroupId = code;
                renderAll();
                return;
            }

            const docRef = await db.collection('groups').doc(code).get();
            if (docRef.exists) {
                savedGroupIds.push(code);
                saveSavedGroupIds();
                state.activeGroupId = code;
                await subscribeToGroup(code);
                // Hide overlay
                document.getElementById('auth-overlay')?.classList.add('hidden');
                document.querySelector('.app-container')?.classList.remove('hidden');
                renderAll();
            } else {
                alert("Trip code not found.");
            }
        } else {
            alert("Please enter a valid 6-8 character code.");
        }
    };

    document.getElementById('login-join-btn')?.addEventListener('click', joinHandler);
    document.getElementById('login-join-code')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinHandler();
    });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
        auth.signOut();
    });
}

function showAuthStatus(message, type = "", duration = 0) {
    const statusEl = document.getElementById('auth-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = 'auth-status ' + type;
    statusEl.classList.remove('hidden');

    if (duration > 0) {
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, duration);
    }
}

function handleAuthError(error) {
    console.error("Login Error:", error);
    showAuthStatus(`Error: ${error.message}`, "error");

    let msg = `Login Failed: ${error.message}`;

    // Check for insecure origin (Non-HTTPS / Non-Localhost)
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        msg = "Google Login requires a secure connection (HTTPS) when using an IP address. \n\nSuggested Fix: \n1. Use 'localhost' on your computer.\n2. Or deploy to Firebase Hosting (which provides HTTPS).\n3. Or use a tunnel like ngrok.";
    } else if (error.code === 'auth/unauthorized-domain') {
        msg = `Unauthorized Domain: Please add '${window.location.hostname}' to your Authorized Domains in the Firebase Console (Authentication > Settings).`;
    } else if (error.code === 'auth/operation-not-allowed' || error.code === 'auth/configuration-not-found') {
        msg = "Google Sign-In is not enabled in your Firebase Console. \n\nFix: Go to Authentication > Sign-in method > Add new provider > Google, and Enable it.";
    } else if (error.code === 'auth/network-request-failed' || error.message.includes('cookies')) {
        msg = "Cookie Error detected. If you are on an iPhone using Safari, please ensure 'Block All Cookies' is turned off in Settings > Safari. Also ensure you are not in Incognito/Private mode.";
    }

    alert(msg);
}

window.resetLocalCache = function () {
    if (confirm("This will clear your local trip list and reset the app. Your trips in Firebase will NOT be deleted. Continue?")) {
        localStorage.clear();
        window.location.reload();
    }
};

async function syncUserGroups(uid) {
    if (userGroupsUnsubscribe) {
        userGroupsUnsubscribe();
        userGroupsUnsubscribe = null;
    }

    if (!uid) return;

    console.log("Starting real-time group sync for account:", uid);

    userGroupsUnsubscribe = db.collection('groups')
        .where('creatorId', '==', uid)
        .onSnapshot(snapshot => {
            let addedCount = 0;
            snapshot.docChanges().forEach(change => {
                if (change.type === "added" || change.type === "modified") {
                    const docId = change.doc.id;
                    if (!savedGroupIds.includes(docId)) {
                        savedGroupIds.push(docId);
                        addedCount++;
                        subscribeToGroup(docId);
                    }
                }
            });

            if (addedCount > 0) {
                console.log(`Synced ${addedCount} new trips from your account.`);
                saveSavedGroupIds();
                renderAll();
            }
        }, error => {
            console.error("Account-level sync error:", error);
        });
}

async function initFirebaseData() {
    // Migrate old local data if it exists
    const oldSaved = localStorage.getItem('splitfool_state');
    if (oldSaved) {
        try {
            const parsed = JSON.parse(oldSaved);
            if (parsed.groups && parsed.groups.length > 0) {
                for (const oldGroup of parsed.groups) {
                    const roomCode = generateRoomCode();
                    const newGroup = { ...oldGroup, id: roomCode };
                    await db.collection('groups').doc(roomCode).set(newGroup);
                    savedGroupIds.push(roomCode);
                }
                localStorage.removeItem('splitfool_state');
                saveSavedGroupIds();
            }
        } catch (e) {
            console.error(e);
        }
    }

    // No default group creation. We require the user to explicitly create or join.

    const promises = savedGroupIds.map(id => subscribeToGroup(id));
    await Promise.all(promises);

    // Ensure active group is valid ONLY if we didn't just explicitly join/select one. 
    // Wait for the snapshot to actually populate `state.groups` before defaulting.
    if (!state.activeGroupId || !state.groups.find(g => g.id === state.activeGroupId)) {
        state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;
    }
}

async function handlePendingInvite(user) {
    const pendingCode = localStorage.getItem('splitfool_pending_invite');
    if (!pendingCode || !user) return;

    // Immediately clear so we don't loop
    localStorage.removeItem('splitfool_pending_invite');
    window.history.replaceState({}, document.title, window.location.pathname);

    try {
        const docRef = await db.collection('groups').doc(pendingCode).get();
        if (!docRef.exists) {
            alert(`Invite link invalid: Trip '${pendingCode}' was not found.`);
            return;
        }

        const groupData = docRef.data();

        // 1. If user already claimed someone in this group, just join it silently
        const alreadyClaimed = groupData.people.some(p => p.userId === user.uid);
        if (alreadyClaimed) {
            await finalizeJoinGroup(pendingCode);
            return;
        }

        // 2. Are there unclaimed people?
        const unclaimedPeople = groupData.people.filter(p => !p.userId);
        if (unclaimedPeople.length > 0) {
            showClaimModal(pendingCode, groupData, user, unclaimedPeople);
        } else {
            showWelcomeJoinModal(pendingCode, groupData, user);
        }
    } catch (e) {
        console.error("Error handling pending invite:", e);
    }
}

async function finalizeJoinGroup(groupId) {
    if (!savedGroupIds.includes(groupId)) {
        savedGroupIds.push(groupId);
        saveSavedGroupIds();
    }
    state.activeGroupId = groupId;
    await subscribeToGroup(groupId);
    renderAll();
}

function showClaimModal(groupId, groupData, user, unclaimedPeople) {
    const modal = document.getElementById('invite-claim-modal');
    if (!modal) return;

    document.getElementById('invite-claim-group-name').textContent = groupData.name;
    const listContainer = document.getElementById('invite-claim-people-list');

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

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCardId = card.dataset.id;
            confirmBtn.disabled = false;
        });
    });

    confirmBtn.onclick = async () => {
        if (!selectedCardId) return;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Claiming...';

        try {
            await claimPersonForInvite(groupId, selectedCardId, user);
            await finalizeJoinGroup(groupId);
            modal.classList.remove('active');
        } catch (e) {
            alert("Error claiming profile.");
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-hand"></i> Claim This Spot';
        }
    };

    const joinNewBtn = document.getElementById('invite-join-as-new-btn');
    joinNewBtn.onclick = () => {
        modal.classList.remove('active');
        showWelcomeJoinModal(groupId, groupData, user);
    };

    modal.classList.add('active');
}

function showWelcomeJoinModal(groupId, groupData, user) {
    const modal = document.getElementById('invite-join-modal');
    if (!modal) return;

    document.getElementById('invite-join-group-name').textContent = groupData.name;
    document.getElementById('invite-join-name').value = user.displayName || '';
    document.getElementById('invite-join-venmo').value = '';

    const confirmBtn = document.getElementById('invite-join-confirm-btn');

    confirmBtn.onclick = async () => {
        const name = document.getElementById('invite-join-name').value.trim();
        let venmo = document.getElementById('invite-join-venmo').value.trim();

        if (!name) {
            alert("Please enter a name.");
            return;
        }

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
                people: firebase.firestore.FieldValue.arrayUnion(newPerson)
            });

            await finalizeJoinGroup(groupId);
            modal.classList.remove('active');
        } catch (e) {
            console.error(e);
            alert("Error joining group.");
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Join Trip';
        }
    };

    modal.classList.add('active');
}

async function claimPersonForInvite(groupId, personId, user) {
    await db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(groupId);
        const doc = await t.get(ref);
        if (!doc.exists) throw new Error("Group does not exist.");

        let groupData = doc.data();
        let pIndex = groupData.people.findIndex(p => p.id === personId);
        if (pIndex !== -1) {
            if (groupData.people[pIndex].userId) {
                throw new Error("This profile is already claimed.");
            }
            groupData.people[pIndex].userId = user.uid;
            t.update(ref, { people: groupData.people });
        }
    });
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function saveSavedGroupIds() {
    localStorage.setItem('splitfool_saved_groups', JSON.stringify(savedGroupIds));
}

async function createNewGroup(name) {
    const roomCode = generateRoomCode();
    const newGroup = {
        id: roomCode,
        name: name,
        people: [],
        expenses: [],
        creatorId: myUserId,
        creatorName: currentUser ? currentUser.displayName : 'Anonymous',
        creatorEmail: currentUser ? currentUser.email : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('groups').doc(roomCode).set(newGroup);
    savedGroupIds.push(roomCode);
    saveSavedGroupIds();
    state.activeGroupId = roomCode;
    return subscribeToGroup(roomCode);
}

function subscribeToGroup(groupId) {
    return new Promise((resolve) => {
        if (unsubscribeListeners[groupId]) return resolve();

        const unsubscribe = db.collection('groups').doc(groupId).onSnapshot(
            doc => {
                if (doc.exists) {
                    const groupData = doc.data();
                    const existingIndex = state.groups.findIndex(g => g.id === groupId);
                    if (existingIndex >= 0) {
                        state.groups[existingIndex] = groupData;
                    } else {
                        state.groups.push(groupData);
                    }
                    renderAll();
                } else {
                    // Document deleted
                    state.groups = state.groups.filter(g => g.id !== groupId);
                    if (state.activeGroupId === groupId) {
                        state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;
                    }
                    unsubscribe();
                    delete unsubscribeListeners[groupId];
                    renderAll();
                }
                resolve();
            },
            error => {
                console.error(`Error subscribing to group ${groupId}:`, error);
                // Important: still resolve so initialization can continue!
                resolve();
            }
        );
        unsubscribeListeners[groupId] = unsubscribe;
    });
}

function renderAll() {
    renderGroupSelector();
    renderPeople();
    renderExpenses();
    renderBalances();
    renderSettleUp();
    updatePayerDropdown();
}

function saveState() {
    const activeGroup = getActiveGroup();
    if (activeGroup && activeGroup.id && activeGroup.id !== 'loading' && activeGroup.id !== 'offline_error' && activeGroup.id !== 'no_groups') {
        // Claim logic: if no creatorId, the person saving it becomes the creator
        if (!activeGroup.creatorId) {
            if (currentUser) {
                activeGroup.creatorId = currentUser.uid;
                activeGroup.creatorName = currentUser.displayName;
                activeGroup.creatorEmail = currentUser.email;
            } else {
                activeGroup.creatorId = myUserId;
                activeGroup.creatorName = 'Anonymous';
            }
        }

        // Use a transaction to prevent race conditions during state updates
        db.runTransaction(async (transaction) => {
            const groupRef = db.collection('groups').doc(activeGroup.id);
            const doc = await transaction.get(groupRef);

            if (!doc.exists) {
                transaction.set(groupRef, activeGroup);
                return;
            }

            // If we are just updating the whole state, merge it carefully or 
            // since this is a general saveState fallback, just update it.
            // Ideally individual actions run their own transactions instead of `saveState()`.
            transaction.update(groupRef, activeGroup);
        }).catch(err => console.error("Transaction failed: ", err));
    }
}

// Currency Names mapping
const CURRENCY_NAMES = {
    "USD": "US Dollar", "MXN": "Mexican Peso", "EUR": "Euro", "GBP": "British Pound",
    "CAD": "Canadian Dollar", "AUD": "Australian Dollar", "JPY": "Japanese Yen",
    "INR": "Indian Rupee", "CNY": "Chinese Yuan", "BRL": "Brazilian Real",
    "SGD": "Singapore Dollar", "ZAR": "South African Rand", "NZD": "New Zealand Dollar",
    "CHF": "Swiss Franc", "HKD": "Hong Kong Dollar", "KRW": "South Korean Won",
    "SEK": "Swedish Krona", "NOK": "Norwegian Krone", "DKK": "Danish Krone",
    "RUB": "Russian Ruble", "TRY": "Turkish Lira", "AED": "UAE Dirham",
    "COP": "Colombian Peso", "ARS": "Argentine Peso", "CLP": "Chilean Peso",
    "PEN": "Peruvian Sol", "PHP": "Philippine Peso", "IDR": "Indonesian Rupiah",
    "MYR": "Malaysian Ringgit", "THB": "Thai Baht", "VND": "Vietnamese Dong",
    "HUF": "Hungarian Forint", "CZK": "Czech Koruna", "PLN": "Polish Zloty",
    "ILS": "Israeli New Shekel", "TWD": "New Taiwan Dollar", "SAR": "Saudi Riyal",
    "KWD": "Kuwaiti Dinar", "EGP": "Egyptian Pound", "VND": "Vietnamese Dong"
};

function getCurrencyLabel(code) {
    if (CURRENCY_NAMES[code]) return `${code} - ${CURRENCY_NAMES[code]}`;

    // Fallback to browser Intl API if available
    try {
        const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
        const name = displayNames.of(code);
        if (name && name !== code) return `${code} - ${name}`;
    } catch (e) { }

    return code;
}

// Global cached exchange rates so we don't spam the API
let cachedExchangeRates = null; // Will store the full rates object from API
let isFetchingRate = false;

// Fetch live exchange rate from a public API (open.er-api.com is free, no auth)
async function fetchExchangeRate() {
    if (cachedExchangeRates || isFetchingRate) return;

    try {
        isFetchingRate = true;
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();

        if (data && data.rates) {
            cachedExchangeRates = data.rates;
            populateCurrencyDropdowns(); // Fill the Expense Currency dropdown
            renderSettleUp(); // Re-render with real rates
        }
    } catch (e) {
        console.error("Failed to fetch live exchange rate", e);
    } finally {
        isFetchingRate = false;
    }
}

function populateCurrencyDropdowns() {
    if (!cachedExchangeRates) return;
    const currencies = Object.keys(cachedExchangeRates).sort();

    // Populate expense form currency dropdown
    const expenseCurrencySelect = document.getElementById('expense-currency');
    if (expenseCurrencySelect) {
        const currentVal = expenseCurrencySelect.value || 'USD';
        expenseCurrencySelect.innerHTML = currencies.map(c => `<option value="${c}">${getCurrencyLabel(c)}</option>`).join('');
        // Restore value if it exists
        if (currencies.includes(currentVal)) {
            expenseCurrencySelect.value = currentVal;
        } else {
            expenseCurrencySelect.value = 'USD';
        }
    }
}

// Group Management Logic
function initGroups() {
    const groupSelect = document.getElementById('active-group-select');
    if (groupSelect) {
        groupSelect.addEventListener('change', (e) => {
            state.activeGroupId = e.target.value;
            saveState();
            renderAll();
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
                renderAll();
            }
        });
    }

    const editGroupBtn = document.getElementById('edit-group-btn');
    const editGroupModal = document.getElementById('edit-group-modal');
    if (editGroupBtn && editGroupModal) {
        editGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            // Permission check
            if (!isGroupAdmin(activeGroup)) {
                alert("Only the group creator can rename this trip.");
                return;
            }

            document.getElementById('edit-group-name').value = activeGroup.name;
            editGroupModal.classList.add('active');
        });

        document.getElementById('save-edit-group-btn').addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            const newName = document.getElementById('edit-group-name').value.trim();
            if (newName && newName !== "") {
                activeGroup.name = newName;
                saveState(); // push to firebase
                renderAll();
                editGroupModal.classList.remove('active');
            }
        });
    }

    const deleteGroupBtn = document.getElementById('delete-group-btn');
    const deleteGroupModal = document.getElementById('delete-confirm-modal');
    if (deleteGroupBtn && deleteGroupModal) {
        deleteGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            // Permission check
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

            // Delete from Firebase
            try {
                await db.collection('groups').doc(activeGroup.id).delete();
            } catch (e) {
                console.error("Error deleting from Firebase:", e);
            }

            // Remove from local known list
            savedGroupIds = savedGroupIds.filter(id => id !== activeGroup.id);
            saveSavedGroupIds();

            // Note: The onSnapshot listener will fire and handle removing it from state.groups automatically!
            state.groups = state.groups.filter(g => g.id !== activeGroup.id);
            state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;

            renderAll();
            deleteGroupModal.classList.remove('active');
        });
    }

    const leaveGroupBtn = document.getElementById('leave-group-btn');
    const leaveGroupModal = document.getElementById('leave-confirm-modal');
    if (leaveGroupBtn && leaveGroupModal) {
        leaveGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            if (activeGroup.id === 'no_groups' || activeGroup.id === 'loading') return;
            leaveGroupModal.classList.add('active');
        });

        document.getElementById('confirm-leave-group-btn').addEventListener('click', () => {
            const activeGroup = getActiveGroup();

            // Remove from local known list
            savedGroupIds = savedGroupIds.filter(id => id !== activeGroup.id);
            saveSavedGroupIds();

            // Unsubscribe
            if (unsubscribeListeners[activeGroup.id]) {
                unsubscribeListeners[activeGroup.id]();
                delete unsubscribeListeners[activeGroup.id];
            }

            // Remove from state
            state.groups = state.groups.filter(g => g.id !== activeGroup.id);
            state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;

            renderAll();
            leaveGroupModal.classList.remove('active');
        });
    }

    // Join and Share Trip Logic
    const joinGroupBtn = document.getElementById('join-group-btn');
    const joinGroupModal = document.getElementById('join-group-modal');
    if (joinGroupBtn && joinGroupModal) {
        joinGroupBtn.addEventListener('click', () => {
            document.getElementById('join-group-code').value = '';
            joinGroupModal.classList.add('active');
        });

        document.getElementById('confirm-join-group-btn').addEventListener('click', async () => {
            const code = document.getElementById('join-group-code').value.trim().toUpperCase();
            if (code && code.length >= 6 && code.length <= 8) {
                if (savedGroupIds.includes(code)) {
                    state.activeGroupId = code;
                    alert("You are already in this trip.");
                    return;
                }

                const docRef = await db.collection('groups').doc(code).get();
                if (docRef.exists) {
                    savedGroupIds.push(code);
                    saveSavedGroupIds();
                    state.activeGroupId = code;
                    try {
                        await subscribeToGroup(code);
                        joinGroupModal.classList.remove('active');
                    } catch (e) {
                        alert("Error: " + e.message);
                    }
                    renderAll();
                } else {
                    alert('Trip code not found.');
                }
            } else {
                alert('Please enter a valid 6-8 character trip code.');
            }
        });
    }

    const shareGroupBtn = document.getElementById('share-group-btn');
    const shareGroupModal = document.getElementById('share-group-modal');
    if (shareGroupBtn && shareGroupModal) {
        shareGroupBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            const inviteUrl = window.location.origin + window.location.pathname + '?join=' + activeGroup.id;

            document.getElementById('share-group-code-display').innerText = activeGroup.id;
            document.getElementById('share-group-link-display').value = inviteUrl;

            const copyBtn = document.getElementById('copy-share-link-btn');
            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
            copyBtn.classList.remove('success');

            shareGroupModal.classList.add('active');
        });

        document.getElementById('copy-share-link-btn').addEventListener('click', function () {
            const linkInput = document.getElementById('share-group-link-display');
            navigator.clipboard.writeText(linkInput.value).then(() => {
                this.innerHTML = '<i class="fa-solid fa-check"></i>';
                this.classList.add('success');
                setTimeout(() => {
                    this.innerHTML = '<i class="fa-solid fa-copy"></i>';
                    this.classList.remove('success');
                }, 2000);
            });
        });
    }
}

function renderGroupSelector() {
    const groupSelect = document.getElementById('active-group-select');
    if (!groupSelect) return;

    groupSelect.innerHTML = state.groups.map(g =>
        `<option value="${escapeHTML(g.id)}" ${g.id === state.activeGroupId ? 'selected' : ''}>${escapeHTML(g.name)}</option>`
    ).join('');

    // Toggle Admin Buttons visibility
    const activeGroup = getActiveGroup();
    const isAdmin = isGroupAdmin(activeGroup);

    const editBtn = document.getElementById('edit-group-btn');
    const deleteBtn = document.getElementById('delete-group-btn');
    const leaveBtn = document.getElementById('leave-group-btn');

    if (editBtn) editBtn.style.display = isAdmin ? 'flex' : 'none';
    if (deleteBtn) deleteBtn.style.display = isAdmin ? 'flex' : 'none';
    if (leaveBtn) leaveBtn.style.display = (!isAdmin && activeGroup.id !== 'no_groups' && activeGroup.id !== 'loading') ? 'flex' : 'none';
}

// Navigation Logic
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabs = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            navBtns.forEach(b => b.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));

            // Add active class to clicked
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');

            // Render specific tab content if needed
            if (tabId === 'people') renderPeople();
            if (tabId === 'expenses') renderExpenses();
            if (tabId === 'balances') renderBalances();
            if (tabId === 'settle') renderSettleUp();
        });
    });
}

// Modal Logic
function initModals() {
    // Add Person Modal
    const personModal = document.getElementById('person-modal');
    document.getElementById('add-person-btn').addEventListener('click', () => {
        const activeGroup = getActiveGroup();
        if (activeGroup.id === 'no_groups' || activeGroup.id === 'loading') {
            alert('Please create or join a trip first.');
            return;
        }
        document.getElementById('person-name').value = '';
        document.getElementById('person-venmo').value = '';
        personModal.classList.add('active');
    });

    // Add Expense Modal
    const expenseModal = document.getElementById('expense-modal');
    document.getElementById('add-expense-btn').addEventListener('click', () => {
        const activeGroup = getActiveGroup();
        if (activeGroup.id === 'no_groups' || activeGroup.id === 'loading') {
            alert('Please create or join a trip first.');
            return;
        }
        if (activeGroup.people.length < 2) {
            alert('Please add at least 2 people first.');
            return;
        }
        resetExpenseForm();
        expenseModal.classList.add('active');
    });

    // Close Modals
    document.querySelectorAll('.close-btn, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        });
    });

    // Save Person handler
    document.getElementById('save-person-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('person-name');
        const venmoInput = document.getElementById('person-venmo');
        if (nameInput.value.trim() !== '') {
            addPerson(nameInput.value.trim(), venmoInput.value.trim());
            personModal.classList.remove('active');
        }
    });

    const editPersonModal = document.getElementById('edit-person-modal');
    if (document.getElementById('save-edit-person-btn')) {
        document.getElementById('save-edit-person-btn').addEventListener('click', async () => {
            const id = editPersonModal.dataset.personId;
            const name = document.getElementById('edit-person-name').value.trim();
            let venmo = document.getElementById('edit-person-venmo').value.trim();

            if (name !== '') {
                const activeGroup = getActiveGroup();
                if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;

                try {
                    await db.runTransaction(async (t) => {
                        const ref = db.collection('groups').doc(activeGroup.id);
                        const doc = await t.get(ref);
                        if (!doc.exists) return;

                        let groupData = doc.data();
                        let pIndex = groupData.people.findIndex(p => p.id === id);
                        if (pIndex !== -1) {
                            groupData.people[pIndex].name = name;
                            groupData.people[pIndex].venmoUsername = venmo;
                            t.update(ref, { people: groupData.people });
                        }
                    });
                    editPersonModal.classList.remove('active');
                } catch (e) {
                    console.error("Edit person transaction failed", e);
                }
            }
        });
    }
}

// Data Operations
window.openEditPersonModal = function (id) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === id);
    if (!person) return;

    // Optional constraint checking at the JavaScript level
    const isOwner = currentUser && person.userId === currentUser.uid;
    if (!isGroupAdmin(activeGroup) && !isOwner) {
        alert("You do not have permission to edit this profile.");
        return;
    }

    document.getElementById('edit-person-name').value = person.name;
    document.getElementById('edit-person-venmo').value = person.venmoUsername || '';
    document.getElementById('edit-person-modal').dataset.personId = id;
    document.getElementById('edit-person-modal').classList.add('active');
};

function addPerson(name, venmo) {
    const activeGroup = getActiveGroup();
    if (activeGroup.id === 'no_groups' || activeGroup.id === 'loading') return;

    const id = 'p_' + Date.now();
    let venmoUsername = venmo || '';
    if (venmoUsername && !venmoUsername.startsWith('@')) venmoUsername = '@' + venmoUsername;

    const newPerson = { id, name, venmoUsername };

    db.collection('groups').doc(activeGroup.id).update({
        people: firebase.firestore.FieldValue.arrayUnion(newPerson)
    }).catch(e => console.error("Error adding person", e));
}

function removePerson(id) {
    const activeGroup = getActiveGroup();
    // Basic validation: Check if they are involved in any expenses locally first
    const involved = activeGroup.expenses.some(e => e.payerId === id || e.participants.some(p => p.personId === id));
    if (involved) {
        alert('Cannot remove a person involved in expenses.');
        return;
    }

    if (personToRemove) {
        db.collection('groups').doc(activeGroup.id).update({
            people: firebase.firestore.FieldValue.arrayRemove(personToRemove)
        }).catch(e => console.error("Error removing person", e));
    }
}

window.claimPerson = async function (id) {
    if (!currentUser) {
        alert("Please log in with Google to claim a profile.");
        return;
    }
    const activeGroup = getActiveGroup();
    try {
        await db.runTransaction(async (t) => {
            const ref = db.collection('groups').doc(activeGroup.id);
            const doc = await t.get(ref);
            if (!doc.exists) return;

            let groupData = doc.data();
            if (groupData.people.some(p => p.userId === currentUser.uid)) {
                throw new Error("You already claimed a profile in this trip.");
            }

            let pIndex = groupData.people.findIndex(p => p.id === id);
            if (pIndex !== -1) {
                if (groupData.people[pIndex].userId) {
                    throw new Error("This profile is already claimed.");
                }
                groupData.people[pIndex].userId = currentUser.uid;
                t.update(ref, { people: groupData.people });
            }
        });
        showAuthStatus("Profile claimed successfully!", "success", 2000);
    } catch (e) {
        alert(e.message);
    }
};

// Render Functions stub
function renderPeople() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('people-list');
    const adminInfo = document.getElementById('group-admin-info');
    list.innerHTML = '';

    // Render Admin Info
    if (adminInfo) {
        if (activeGroup.creatorId) {
            const isAdmin = isGroupAdmin(activeGroup);
            const adminName = activeGroup.creatorName || 'Anonymous';
            adminInfo.innerHTML = `
                <div class="admin-badge ${isAdmin ? 'is-self' : ''}">
                    <i class="fa-solid fa-shield-halved"></i> 
                    Admin: <strong>${isAdmin ? 'You' : adminName}</strong>
                </div>
            `;
            adminInfo.classList.remove('hidden');
        } else {
            adminInfo.classList.add('hidden');
        }
    }

    if (activeGroup.people.length === 0) {
        list.innerHTML = '<p class="subtitle">No people added yet. Add some friends to get started!</p>';
        return;
    }

    const isGroupAdminFlag = isGroupAdmin(activeGroup);
    const hasClaimedSomeone = activeGroup.people.some(p => currentUser && p.userId === currentUser.uid);

    activeGroup.people.forEach(p => {
        const safeName = escapeHTML(p.name);
        const char = safeName.charAt(0).toUpperCase();
        const safeVenmo = escapeHTML(p.venmoUsername);
        const venmoBadge = safeVenmo ? `<span style="color:#008CFF; font-size: 0.8em; margin-left: 0.5rem;"><i class="fa-brands fa-venmo"></i> ${safeVenmo}</span>` : '';

        let claimBtnHtml = '';
        let controlsHtml = '';
        const isOwner = currentUser && p.userId === currentUser.uid;

        if (currentUser && !p.userId && !hasClaimedSomeone) {
            claimBtnHtml = `<button class="btn" style="padding: 4px 12px; font-size: 0.8rem; height: 30px; border-radius: 8px; margin-left: 0.5rem;" onclick="claimPerson('${escapeHTML(p.id)}')"><i class="fa-solid fa-hand" style="margin-right: 4px;"></i> Claim</button>`;
        } else if (p.userId) {
            if (isOwner) {
                claimBtnHtml = `<span class="badge" style="background:var(--success); color:#fff; font-size:0.7rem; padding: 2px 6px; border-radius:10px; margin-left: 0.5rem;">You</span>`;
            } else {
                claimBtnHtml = `<span class="badge" style="background:rgba(255,255,255,0.1); color:var(--text-muted); font-size:0.7rem; padding: 2px 6px; border-radius:10px; margin-left: 0.5rem;">Claimed</span>`;
            }
        }

        if (isGroupAdminFlag || isOwner) {
            controlsHtml += `
                    <button class="btn icon-btn" onclick="openEditPersonModal('${escapeHTML(p.id)}')">
                        <i class="fa-solid fa-pen"></i>
                    </button>`;
        }

        if (isGroupAdminFlag) {
            controlsHtml += `
                    <button class="btn danger" onclick="removePerson('${escapeHTML(p.id)}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>`;
        }

        list.innerHTML += `
            <div class="card person-card" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="person-info" style="display:flex; align-items:center; gap: 1rem; flex: 1;">
                    <div class="avatar">${char}</div>
                    <div>
                        <h3 style="margin:0; display:flex; align-items:center; flex-wrap: wrap;">${safeName} ${claimBtnHtml}</h3>
                        ${venmoBadge ? `<div>${venmoBadge}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap: 0.5rem;">
                    ${controlsHtml}
                </div>
            </div>
        `;
    });
}

// Helper to populate payer dropdown
function updatePayerDropdown() {
    const activeGroup = getActiveGroup();
    const payerSelect = document.getElementById('expense-payer');
    if (!payerSelect) return;

    const currentVal = payerSelect.value;
    payerSelect.innerHTML = activeGroup.people.map(p =>
        `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`
    ).join('');

    if (currentVal && activeGroup.people.some(p => p.id === currentVal)) {
        payerSelect.value = currentVal;
    } else if (activeGroup.people.length > 0) {
        payerSelect.value = activeGroup.people[0].id;
    }

    try {
        if (typeof renderMultiplePayers === 'function') {
            renderMultiplePayers();
        }
    } catch (e) {
        console.error("Failed to render multiple payers:", e);
    }
}

let currentPayerMode = 'single'; // 'single' or 'multiple'
let currentSplitMode = 'equal'; // equal, exact, percent

window.togglePayerMode = function (mode) {
    try {
        currentPayerMode = mode;
        const singleBtn = document.getElementById('single-payer-btn');
        const multiBtn = document.getElementById('multi-payer-btn');

        if (singleBtn) singleBtn.classList.toggle('active', mode === 'single');
        if (multiBtn) multiBtn.classList.toggle('active', mode === 'multiple');

        const expPayer = document.getElementById('expense-payer');
        const mpList = document.getElementById('multiple-payers-list');
        const mpSumm = document.getElementById('multiple-payers-summary');

        if (mode === 'single') {
            if (expPayer) expPayer.classList.remove('hidden');
            if (mpList) mpList.classList.add('hidden');
            if (mpSumm) mpSumm.classList.add('hidden');
        } else {
            if (expPayer) expPayer.classList.add('hidden');
            if (mpList) mpList.classList.remove('hidden');
            if (mpSumm) mpSumm.classList.remove('hidden');
            renderMultiplePayers();
        }
        updateSplitSummary();
    } catch (e) {
        console.error("togglePayerMode failed", e);
    }
};

window.updateMultiplePayersSummary = function () {
    try {
        const amtInput = document.getElementById('expense-amount');
        if (!amtInput) return;
        const expectedTotal = parseFloat(amtInput.value) || 0;
        let actualTotal = 0;

        document.querySelectorAll('.multi-payer-input').forEach(input => {
            actualTotal += parseFloat(input.value) || 0;
        });

        const totalAmtDisp = document.getElementById('payers-total-amount');
        if (totalAmtDisp) totalAmtDisp.textContent = actualTotal.toFixed(2);

        const expAmtDisp = document.getElementById('payers-expected-total');
        if (expAmtDisp) expAmtDisp.textContent = expectedTotal.toFixed(2);

        const summaryEl = document.getElementById('multiple-payers-summary');
        if (summaryEl) {
            if (Math.abs(actualTotal - expectedTotal) > 0.05 && expectedTotal > 0) {
                summaryEl.classList.add('error');
            } else {
                summaryEl.classList.remove('error');
            }
        }
    } catch (e) {
        console.error("updateMultiplePayersSummary failed", e);
    }
};

function renderMultiplePayers() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('multiple-payers-list');
    if (!container) return;

    if (!activeGroup || !activeGroup.people) return;

    const currentValues = {};
    try {
        document.querySelectorAll('.multi-payer-input').forEach(input => {
            if (input && input.id) {
                const id = input.id.replace('mp_', '');
                currentValues[id] = input.value;
            }
        });
    } catch (e) {
        console.error("Failed to get current values", e);
    }

    container.innerHTML = activeGroup.people.map(p => {
        const safeName = escapeHTML(p.name);
        const safeId = escapeHTML(p.id);
        const prevValue = currentValues[safeId] || '';

        return `
        <div class="participant-card active" style="margin-bottom: 8px;">
            <div class="participant-item-left">
                <div class="participant-avatar">${safeName.charAt(0).toUpperCase()}</div>
                <label>${safeName}</label>
            </div>
            <div class="participant-input-container">
                <input type="number" id="mp_${safeId}" class="multi-payer-input" placeholder="0" step="0.01" min="0" value="${prevValue}" oninput="updateMultiplePayersSummary()">
                <span class="split-unit">$</span>
            </div>
        </div>
        `;
    }).join('');

    updateMultiplePayersSummary();
}

function resetExpenseForm() {
    try {
        const activeGroup = getActiveGroup();
        document.getElementById('expense-id').value = '';
        document.getElementById('expense-modal-title').textContent = 'Add Expense';
        document.getElementById('expense-desc').value = '';
        document.getElementById('expense-amount').value = '';
        document.getElementById('expense-currency').value = 'USD';

        togglePayerMode('single');

        // Populate payers with XSS protection
        updatePayerDropdown();

        // Ensure we start fresh, caching won't inherit an edited expense's state
        document.getElementById('split-participants').innerHTML = '';

        // Populate participants
        renderSplitParticipants();

        // Reset tabs
        document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.split-tab[data-split="equal"]').classList.add('active');
        currentSplitMode = 'equal';
        updateSplitSummary();
    } catch (e) {
        console.error("Error resetting expense form:", e);
    }
}

function renderSplitParticipants() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('split-participants');

    // Cache existing checkbox states and input values to prevent overwriting user progress
    const currentStates = {};
    const currentValues = {};
    document.querySelectorAll('.participant-cb').forEach(cb => {
        const id = cb.id.replace('part_', '');
        currentStates[id] = cb.checked;
    });
    document.querySelectorAll('.participant-input').forEach(input => {
        const id = input.id.replace('input_', '');
        currentValues[id] = input.value;
    });

    if (currentSplitMode === 'paid_for') {
        const payerId = document.getElementById('expense-payer').value;
        const otherPeople = activeGroup.people.filter(p => p.id !== payerId);

        container.innerHTML = `
            <div class="form-group" style="margin-top: 1rem;">
                <label>Who did you pay for?</label>
                <select id="paid-for-select" class="participant-input" style="margin-bottom: 1rem;" onchange="updateSplitSummary()">
                    ${otherPeople.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
                </select>
            </div>
        `;
        return; // Early return for paid_for mode
    }

    container.innerHTML = activeGroup.people.map(p => {
        const safeName = escapeHTML(p.name);
        const safeId = escapeHTML(p.id);
        const splitUnit = currentSplitMode === 'percent' ? '%' : (currentSplitMode === 'shares' ? 'shares' : '$');

        const isChecked = currentStates[safeId] !== undefined ? currentStates[safeId] : true;
        const prevValue = currentValues[safeId] || '';

        return `
        <div class="participant-card ${isChecked ? 'active' : ''}" id="card_${safeId}" onclick="toggleParticipant('${safeId}')">
            <div class="participant-item-left">
                <input type="checkbox" id="part_${safeId}" class="participant-cb" value="${safeId}" ${isChecked ? 'checked' : ''} style="display:none;" onchange="updateSplitSummary()">
                <div class="participant-avatar">${safeName.charAt(0).toUpperCase()}</div>
                <label for="part_${safeId}" onclick="event.preventDefault()">${safeName}</label>
            </div>
            <div class="participant-input-container" onclick="event.stopPropagation()">
                <input type="number" id="input_${safeId}" class="participant-input" placeholder="0" step="0.01" min="0" value="${prevValue}"
                    ${currentSplitMode === 'equal' ? 'disabled' : ''} oninput="updateSplitSummary()">
                <span class="split-unit">${splitUnit}</span>
            </div>
        </div>
    `}).join('');
}

// Global helper for the new touch cards
window.toggleParticipant = function (id) {
    const cb = document.getElementById('part_' + id);
    const card = document.getElementById('card_' + id);
    if (!cb || !card) return;

    cb.checked = !cb.checked;

    if (cb.checked) {
        card.classList.add('active');
    } else {
        card.classList.remove('active');
    }

    updateSplitSummary();
};

// Add event listeners for split tabs
document.querySelectorAll('.split-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentSplitMode = e.target.getAttribute('data-split');

        // Update UI
        renderSplitParticipants();
        updateSplitSummary();
    });
});

document.getElementById('expense-payer').addEventListener('change', () => {
    if (currentSplitMode === 'paid_for') {
        renderSplitParticipants();
        updateSplitSummary();
    }
});

document.getElementById('expense-amount').addEventListener('input', updateSplitSummary);

function updateSplitSummary() {
    const totalAmount = parseFloat(document.getElementById('expense-amount').value) || 0;
    const isEditingAmount = currentSplitMode !== 'equal';

    document.getElementById('expense-total-display').textContent = totalAmount.toFixed(2);

    // Scope to the split-participants container only to avoid collisions with
    // the paid-for select or multi-payer inputs which share the same class names.
    const splitContainer = document.getElementById('split-participants');
    if (!splitContainer) return;

    // Also scope the checked count to the same container so totalSelected is always
    // accurate — a global query could pick up stale checked elements from old renders.
    const checkboxes = splitContainer.querySelectorAll('.participant-cb:checked');
    const totalSelected = checkboxes.length;

    splitContainer.querySelectorAll('.participant-input').forEach(input => {
        const id = input.id.replace('input_', '');
        const cbEl = document.getElementById('part_' + id);
        if (!cbEl) return; // Safety guard — skip non-participant inputs
        const isChecked = cbEl.checked;

        if (!isChecked) {
            input.value = '';
            input.disabled = true;
            return;
        }

        input.disabled = currentSplitMode === 'equal';

        if (currentSplitMode === 'equal' && totalSelected > 0) {
            const splitAmount = totalAmount / totalSelected;
            input.value = splitAmount.toFixed(2);
            currentTotal += splitAmount;
        } else {
            currentTotal += parseFloat(input.value) || 0;
        }
    });

    const summaryEl = document.getElementById('split-summary');
    const totalEl = document.getElementById('split-total-amount');

    if (currentSplitMode === 'paid_for') {
        totalEl.textContent = totalAmount.toFixed(2);
        summaryEl.classList.remove('error');
        return;
    }

    if (currentSplitMode === 'percent') {
        totalEl.textContent = currentTotal.toFixed(1) + '%';
        if (Math.abs(currentTotal - 100) > 0.1 && checkboxes.length > 0) {
            summaryEl.classList.add('error');
        } else {
            summaryEl.classList.remove('error');
        }
    } else if (currentSplitMode === 'shares') {
        totalEl.textContent = currentTotal.toFixed(1) + ' shares';
        // No total validation needed for shares, they are proportional
        summaryEl.classList.remove('error');
    } else if (currentSplitMode === 'equal') {
        // For equal mode, calculate properly and show — no error check needed
        if (totalSelected > 0) {
            totalEl.textContent = totalAmount.toFixed(2);
        } else {
            totalEl.textContent = '0.00';
        }
        summaryEl.classList.remove('error');
    } else {
        totalEl.textContent = currentTotal.toFixed(2);
        if (Math.abs(currentTotal - totalAmount) > 0.05 && checkboxes.length > 0) {
            summaryEl.classList.add('error');
        } else {
            summaryEl.classList.remove('error');
        }
    }
}

document.getElementById('save-expense-btn').addEventListener('click', () => {
    const desc = document.getElementById('expense-desc').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const currency = document.getElementById('expense-currency').value;
    const payerId = document.getElementById('expense-payer').value;

    if (!desc || isNaN(amount) || amount <= 0) {
        alert('Please enter a valid description and amount.');
        return;
    }

    let payers = [];
    if (currentPayerMode === 'single') {
        const payerId = document.getElementById('expense-payer').value;
        payers.push({ personId: payerId, amount: amount });
    } else {
        const summaryEl = document.getElementById('multiple-payers-summary');
        if (summaryEl.classList.contains('error')) {
            alert('The multiple payers total does not match the expense amount.');
            return;
        }
        document.querySelectorAll('.multi-payer-input').forEach(input => {
            const val = parseFloat(input.value) || 0;
            if (val > 0) {
                const personId = input.id.replace('mp_', '');
                payers.push({ personId, amount: val });
            }
        });
        if (payers.length === 0) {
            alert('Please specify who paid for this expense.');
            return;
        }
    }

    const participants = [];

    if (currentSplitMode === 'paid_for') {
        const owedById = document.getElementById('paid-for-select').value;
        if (!owedById) {
            alert('Please select who you paid for.');
            return;
        }
        participants.push({ personId: owedById, share: amount });
    } else {
        const checkboxes = document.querySelectorAll('.participant-cb:checked');
        if (checkboxes.length === 0) {
            alert('Please select at least one participant.');
            return;
        }

        const summaryEl = document.getElementById('split-summary');
        if (summaryEl.classList.contains('error')) {
            alert('The assigned splits do not add up to the total.');
            return;
        }

        checkboxes.forEach(cb => {
            const personId = cb.value;
            let val;
            if (currentSplitMode === 'equal') {
                // Always compute fresh for equal mode — don't rely on disabled DOM inputs
                val = amount / checkboxes.length;
            } else {
                val = parseFloat(document.getElementById('input_' + personId).value) || 0;
            }
            participants.push({ personId, share: val });
        });
    }

    const expenseIdInput = document.getElementById('expense-id');
    const existingId = expenseIdInput.value;

    const expense = {
        id: existingId || 'e_' + Date.now(),
        description: desc,
        amount,
        currency,
        payerId: payers[0].personId, // fallback for legacy clients
        payers: payers,
        splitType: currentSplitMode,
        participants
    };

    const activeGroup = getActiveGroup();

    db.runTransaction(async (t) => {
        const ref = db.collection('groups').doc(activeGroup.id);
        const doc = await t.get(ref);
        if (!doc.exists) return;

        let groupData = doc.data();

        if (existingId) {
            const index = groupData.expenses.findIndex(e => e.id === existingId);
            if (index !== -1) {
                groupData.expenses[index] = expense;
            }
        } else {
            groupData.expenses.push(expense);
        }

        t.update(ref, { expenses: groupData.expenses });
    }).then(() => {
        expenseIdInput.value = ''; // Reset
        document.getElementById('expense-modal').classList.remove('active');
    }).catch(e => {
        console.error("Expense transaction failed", e);
        alert("Failed to save expense. Please try again.");
    });
});

window.editExpense = function (id) {
    const activeGroup = getActiveGroup();
    const expense = activeGroup.expenses.find(e => e.id === id);
    if (!expense) return;

    // Open modal
    document.getElementById('expense-modal').classList.add('active');
    document.getElementById('expense-modal-title').textContent = 'Edit Expense';

    // Populate payers list before setting value
    updatePayerDropdown();
    document.getElementById('expense-id').value = id;
    document.getElementById('expense-desc').value = expense.description;
    document.getElementById('expense-amount').value = expense.amount;
    document.getElementById('expense-currency').value = expense.currency;

    // Restore payers
    if (expense.payers && expense.payers.length > 1) {
        togglePayerMode('multiple');
        expense.payers.forEach(p => {
            const input = document.getElementById('mp_' + p.personId);
            if (input) input.value = p.amount;
        });
        updateMultiplePayersSummary();
    } else {
        togglePayerMode('single');
        document.getElementById('expense-payer').value = expense.payers ? expense.payers[0].personId : expense.payerId;
    }

    // Set split mode
    currentSplitMode = expense.splitType;
    document.querySelectorAll('.split-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-split') === currentSplitMode);
    });

    // Clear existing DOM so renderSplitParticipants doesn't incorrectly cache previous state
    document.getElementById('split-participants').innerHTML = '';

    renderSplitParticipants();

    // Force clear all defaults since renderSplitParticipants assumes 'true' for new renders
    document.querySelectorAll('.participant-cb').forEach(cb => cb.checked = false);
    document.querySelectorAll('.participant-card').forEach(card => card.classList.remove('active'));
    document.querySelectorAll('.participant-input').forEach(input => input.value = '');

    // Fill participant values
    expense.participants.forEach(p => {
        const cb = document.getElementById('part_' + p.personId);
        const card = document.getElementById('card_' + p.personId);
        const input = document.getElementById('input_' + p.personId);

        if (cb) cb.checked = true;
        if (card) card.classList.add('active');
        if (input) input.value = p.share;
    });

    if (currentSplitMode === 'paid_for' && expense.participants.length > 0) {
        document.getElementById('paid-for-select').value = expense.participants[0].personId;
    }

    updateSplitSummary();
};

window.deleteExpense = function (id) {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    const activeGroup = getActiveGroup();
    const expenseToRemove = activeGroup.expenses.find(e => e.id === id);

    if (expenseToRemove) {
        db.collection('groups').doc(activeGroup.id).update({
            expenses: firebase.firestore.FieldValue.arrayRemove(expenseToRemove)
        }).catch(e => console.error("Error removing expense", e));
    }
};

function renderExpenses() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('expense-list');
    list.innerHTML = '';

    const countDisplay = document.getElementById('expense-count-display');
    if (countDisplay) {
        const count = activeGroup.expenses.length;
        countDisplay.textContent = count > 0 ? `(${count})` : '';
    }

    if (activeGroup.expenses.length === 0) {
        list.innerHTML = '<p class="subtitle">No expenses added yet.</p>';
        return;
    }

    // Sort descending by id (newest first)
    const sorted = [...activeGroup.expenses].sort((a, b) => b.id.localeCompare(a.id));

    sorted.forEach(e => {
        let payerText = '';
        if (e.payers && e.payers.length > 1) {
            const payerNames = e.payers.map(p => {
                const person = activeGroup.people.find(person => person.id === p.personId);
                return person ? person.name : 'Unknown';
            });
            payerText = escapeHTML(payerNames.join(', '));
        } else {
            const rawPayerName = activeGroup.people.find(p => p.id === e.payerId)?.name || 'Unknown';
            payerText = escapeHTML(rawPayerName);
        }

        const symbol = escapeHTML(e.currency);

        let participantNames;
        if (e.participants.length === activeGroup.people.length && activeGroup.people.length > 0) {
            participantNames = 'All';
        } else {
            const names = e.participants.map(part => {
                const person = activeGroup.people.find(p => p.id === part.personId);
                return person ? person.name : 'Unknown';
            });
            participantNames = escapeHTML(names.join(', ')) + ` <span style="color: var(--primary); font-weight: bold;">(${e.participants.length})</span>`;
        }

        const safeDesc = escapeHTML(e.description);
        const safeId = escapeHTML(e.id);
        const safeSplit = escapeHTML(e.splitType);

        list.innerHTML += `
            <div class="card expense-card" id="exp_${safeId}">
                <div class="expense-header">
                    <div style="flex:1">
                        <h3>${safeDesc}</h3>
                    </div>
                    <div class="amount">${symbol} ${e.amount.toFixed(2)}</div>
                    <div class="expense-actions">
                        <button class="expense-action-btn edit" onclick="editExpense('${safeId}')" title="Edit Expense">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="expense-action-btn delete" onclick="deleteExpense('${safeId}')" title="Delete Expense">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="expense-details" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
                    <div class="payer-badge" style="color: var(--text-main);">
                        Paid by <strong>${payerText}</strong>
                    </div>
                    <div class="split-info" style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--text-muted); font-size: 0.9em;">
                        <span>For: ${participantNames}</span>
                        <span class="split-badge" style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; text-transform: capitalize; color: var(--text-main);">
                            ${safeSplit.replace('_', ' ')}
                        </span>
                    </div>
                </div>
            </div>
        `;
    });
}

function calculateBalances() {
    const activeGroup = getActiveGroup();
    const balances = {};

    // Initialize (we'll add currencies dynamically)
    activeGroup.people.forEach(p => {
        balances[p.id] = {};
    });

    // Calculate per expense
    activeGroup.expenses.forEach(e => {
        const amount = e.amount;
        const cur = e.currency;

        // Ensure currency exists for payer
        if (e.payers && e.payers.length > 0) {
            e.payers.forEach(payer => {
                if (balances[payer.personId]) {
                    if (!balances[payer.personId][cur]) balances[payer.personId][cur] = 0;
                    balances[payer.personId][cur] += payer.amount;
                }
            });
        } else if (balances[e.payerId]) { // Fallback for old expenses
            if (!balances[e.payerId][cur]) balances[e.payerId][cur] = 0;
            balances[e.payerId][cur] += amount;
        }

        // Participants get debt
        let totalShares = 0;
        if (e.splitType === 'shares') {
            totalShares = e.participants.reduce((sum, p) => sum + p.share, 0);
        }

        e.participants.forEach(p => {
            if (!balances[p.personId]) return;

            let debt = 0;
            if (e.splitType === 'equal') {
                debt = amount / e.participants.length;
            } else if (e.splitType === 'exact' || e.splitType === 'paid_for') {
                debt = p.share;
            } else if (e.splitType === 'percent') {
                debt = (amount * p.share) / 100;
            } else if (e.splitType === 'shares') {
                if (totalShares > 0) {
                    debt = amount * (p.share / totalShares);
                }
            }

            // Round debt to nearest cent to prevent floating point drift
            // (e.g., 100/3 = 33.3333... → 33.33 so 3 participants sum to 99.99, not 100.00000001)
            debt = Math.round(debt * 100) / 100;

            if (!balances[p.personId][cur]) balances[p.personId][cur] = 0;
            balances[p.personId][cur] -= debt;
        });
    });

    // Final pass: snap every balance to the nearest cent to eliminate
    // any accumulated floating point residue before returning.
    for (const personId of Object.keys(balances)) {
        for (const cur of Object.keys(balances[personId])) {
            balances[personId][cur] = Math.round(balances[personId][cur] * 100) / 100;
        }
    }

    return balances;
}

function renderBalances() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('balances-list');
    list.innerHTML = '';

    if (activeGroup.people.length === 0) {
        list.innerHTML = '<p class="subtitle">Add people to see balances.</p>';
        return;
    }

    const balances = calculateBalances();

    activeGroup.people.forEach(p => {
        const b = balances[p.id];
        let balanceHtml = '';

        if (Object.keys(b).length === 0) {
            balanceHtml = `<div style="font-size:0.9rem; color:var(--text-muted);">settled up</div>`;
        } else {
            balanceHtml = `<div style="font-size:0.9rem; color:var(--text-muted);">`;
            for (const [currency, amount] of Object.entries(b)) {
                // Formatting
                if (Math.abs(amount) > 0.01) {
                    const cssClass = amount > 0.01 ? 'positive' : 'negative';
                    const text = amount > 0.01 ? `gets back ${amount.toFixed(2)}` : `owes ${Math.abs(amount).toFixed(2)}`;
                    balanceHtml += `${currency}: <span class="amount ${cssClass}">${text}</span><br>`;
                }
            }
            if (balanceHtml === `<div style="font-size:0.9rem; color:var(--text-muted);">`) {
                balanceHtml = `<div style="font-size:0.9rem; color:var(--text-muted);">settled up</div>`;
            } else {
                balanceHtml += `</div>`;
            }
        }

        const safeName = escapeHTML(p.name);
        const safeId = escapeHTML(p.id);
        const char = safeName.charAt(0).toUpperCase();

        list.innerHTML += `
            <div class="card person-card">
                <div class="person-info">
                    <div class="avatar">${char}</div>
                    <div>
                        <h3>${safeName}</h3>
                        ${balanceHtml}
                    </div>
                </div>
            </div>
        `;
    });
}

function simplifyDebts(balances, currency) {
    const debtors = [];
    const creditors = [];

    // Separate into debtors and creditors
    for (const [personId, personBals] of Object.entries(balances)) {
        const bal = personBals[currency];
        if (bal < -0.01) {
            debtors.push({ id: personId, amount: Math.abs(bal) });
        } else if (bal > 0.01) {
            creditors.push({ id: personId, amount: bal });
        }
    }

    // Sort descending by amount to minimize transactions (greedy approach)
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let i = 0; // debtor index
    let j = 0; // creditor index

    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];

        const amount = Math.min(debtor.amount, creditor.amount);

        transactions.push({
            from: debtor.id,
            to: creditor.id,
            amount: amount
        });

        debtor.amount -= amount;
        creditor.amount -= amount;

        if (debtor.amount < 0.01) i++;
        if (creditor.amount < 0.01) j++;
    }

    return transactions;
}

// Settlement Event Listeners
document.getElementById('manual-rate')?.addEventListener('input', renderSettleUp);
document.getElementById('settle-mode')?.addEventListener('change', () => {
    // Clear manual rate when switching modes
    const manualRate = document.getElementById('manual-rate');
    if (manualRate) manualRate.value = '';
    renderSettleUp();
});

function renderSettleUp() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('settle-results-container');
    const modeSelect = document.getElementById('settle-mode');
    const breakdownContainer = document.getElementById('settlement-breakdown');
    const breakdownList = document.getElementById('breakdown-list');
    const manualRateContainer = document.getElementById('manual-rate-container');
    const manualRateInput = document.getElementById('manual-rate');

    if (!container || !modeSelect) return;

    container.innerHTML = '';
    if (breakdownContainer) breakdownContainer.classList.add('hidden');

    const memberBreakdownSection = document.getElementById('member-breakdown-section');
    if (memberBreakdownSection) memberBreakdownSection.classList.add('hidden');

    if (activeGroup.people.length === 0 || activeGroup.expenses.length === 0) {
        container.innerHTML = '<div><p class="subtitle">No debts to settle.</p></div>';
        if (manualRateContainer) manualRateContainer.classList.add('hidden');
        return;
    }

    const balances = calculateBalances();

    // 1. Find all unique currencies used and group totals
    const groupTotals = {};
    const usedCurrencies = new Set();
    activeGroup.expenses.forEach(e => {
        if (!groupTotals[e.currency]) groupTotals[e.currency] = 0;
        groupTotals[e.currency] += e.amount;
        usedCurrencies.add(e.currency);
    });

    for (const [personId, personBals] of Object.entries(balances)) {
        for (const [cur, amt] of Object.entries(personBals)) {
            if (Math.abs(amt) > 0.01) usedCurrencies.add(cur);
        }
    }

    if (usedCurrencies.size === 0) {
        container.innerHTML = '<div class="card" style="text-align:center; padding: 1rem;">All settled up! 🎉</div>';
        if (manualRateContainer) manualRateContainer.classList.add('hidden');
        return;
    }

    // 2. Populate options
    const currentMode = modeSelect.value;
    let availableTargets;
    if (cachedExchangeRates) {
        availableTargets = Object.keys(cachedExchangeRates).sort();
    } else {
        availableTargets = Array.from(new Set(['USD', 'PHP', 'MXN', 'EUR', 'GBP', ...usedCurrencies])).sort();
    }

    let optionsHtml = '<option value="separate">Separate Currencies (More Transactions)</option>';
    availableTargets.forEach(cur => {
        optionsHtml += `<option value="${cur}">${getCurrencyLabel(cur)} (Simplified)</option>`;
    });

    if (modeSelect.innerHTML !== optionsHtml) {
        modeSelect.innerHTML = optionsHtml;

        // AUTO-DEFAULT LOGIC
        if (currentMode === 'separate' || !currentMode) {
            if (usedCurrencies.size > 1) {
                // Pick the most used currency
                let bestCur = 'USD';
                let maxTotal = -1;
                for (const [cur, total] of Object.entries(groupTotals)) {
                    if (total > maxTotal) {
                        maxTotal = total;
                        bestCur = cur;
                    }
                }
                modeSelect.value = bestCur;
            } else {
                modeSelect.value = 'separate';
            }
        } else {
            modeSelect.value = currentMode;
        }
    }

    const activeMode = modeSelect.value;
    const isCombined = activeMode !== 'separate';

    // Toggle Manual Rate UI
    if (isCombined && usedCurrencies.size > 1) {
        if (manualRateContainer) {
            manualRateContainer.classList.remove('hidden');
            const otherCur = Array.from(usedCurrencies).find(c => c !== activeMode) || 'USD';
            document.getElementById('manual-rate-source').textContent = otherCur;
            document.getElementById('manual-rate-target').textContent = activeMode;
        }
    } else {
        if (manualRateContainer) manualRateContainer.classList.add('hidden');
    }

    const renderTxList = (transactions, currency) => {
        if (transactions.length === 0) return '';
        let html = '<ul class="settle-list" style="padding: 0; margin-top: 1rem;">';
        transactions.forEach(tx => {
            const fromPerson = activeGroup.people.find(p => p.id === tx.from);
            const toPerson = activeGroup.people.find(p => p.id === tx.to);
            const fromName = fromPerson?.name || 'Unknown';
            const toName = toPerson?.name || 'Unknown';

            let venmoBtn = '';
            if (toPerson && toPerson.venmoUsername) {
                const cleanUsername = toPerson.venmoUsername.replace('@', '');
                const venmoUrl = `https://venmo.com/?tx=pay&txn=pay&audience=private&recipients=${cleanUsername}&amount=${tx.amount.toFixed(2)}&note=SplitFool%20Settlement`;
                venmoBtn = `<a href="${venmoUrl}" target="_blank" class="btn" style="background:#008CFF; color:white; padding:0.25rem 0.5rem; text-decoration:none; font-size:0.8rem; border-radius:4px; margin-left:0.5rem; display:inline-flex; align-items:center; gap:0.25rem;"><i class="fa-brands fa-venmo"></i> Pay</a>`;
            }

            html += `
                <li style="list-style:none; margin-bottom: 0.5rem;">
                    <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding: 0.75rem 1rem;">
                        <div style="display:flex; align-items:center;">
                            <strong>${escapeHTML(fromName)}</strong>&nbsp;pays&nbsp;<strong>${escapeHTML(toName)}</strong>
                            ${venmoBtn}
                        </div>
                        <div class="amount positive" style="font-weight: 800;">${tx.amount.toFixed(2)} ${escapeHTML(currency)}</div>
                    </div>
                </li>
            `;
        });
        html += '</ul>';
        return html;
    };

    if (!isCombined) {
        let finalHtml = '';
        usedCurrencies.forEach(cur => {
            const txs = simplifyDebts(balances, cur);
            if (txs.length > 0) {
                finalHtml += `
                    <h3 style="margin-top: ${finalHtml ? '2rem' : '0'}"><i class="fa-solid fa-coins"></i> ${cur} Settlements</h3>
                    ${renderTxList(txs, cur)}
                `;
            }
        });
        container.innerHTML = finalHtml || '<div class="card" style="text-align:center; padding: 1rem;">All settled up! 🎉</div>';
    } else {
        const targetCurrency = activeMode;
        const manualRate = parseFloat(manualRateInput?.value);

        if (!cachedExchangeRates && isNaN(manualRate)) {
            container.innerHTML = '<div class="card" style="color:var(--danger)">No exchange rates available. Please enter a manual rate above.</div>';
            return;
        }

        // Show Breakdown
        if (breakdownContainer && breakdownList) {
            breakdownContainer.classList.remove('hidden');
            let bHtml = '<table style="width:100%; border-collapse: collapse;">';
            bHtml += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><th style="text-align:left; padding: 0.5rem 0;">Currency</th><th style="text-align:right;">Subtotal</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Total (${targetCurrency})</th></tr>';

            let grandTotal = 0;
            usedCurrencies.forEach(cur => {
                const subtotal = groupTotals[cur] || 0;
                let rate = 1;

                if (cur !== targetCurrency) {
                    if (!isNaN(manualRate)) {
                        rate = manualRate;
                    } else if (cachedExchangeRates && cachedExchangeRates[cur] && cachedExchangeRates[targetCurrency]) {
                        rate = cachedExchangeRates[targetCurrency] / cachedExchangeRates[cur];
                    }
                }

                const converted = subtotal * rate;
                grandTotal += converted;

                bHtml += `
                    <tr>
                        <td style="padding: 0.5rem 0;">${cur}</td>
                        <td style="text-align:right;">${subtotal.toFixed(2)}</td>
                        <td style="text-align:right; color: var(--text-muted); font-size: 0.8rem;">${cur === targetCurrency ? '-' : rate.toFixed(4)}</td>
                        <td style="text-align:right; font-weight: 600;">${converted.toFixed(2)}</td>
                    </tr>
                `;
            });
            bHtml += `<tr style="border-top: 2px solid var(--primary);"><td colspan="3" style="padding-top: 0.5rem; text-align:right; font-weight: 800;">Grand Total:</td><td style="padding-top: 0.5rem; text-align:right; font-weight: 800; color: var(--primary);">${grandTotal.toFixed(2)} ${targetCurrency}</td></tr>`;
            bHtml += '</table>';
            breakdownList.innerHTML = bHtml;
        }

        const combinedBalances = {};
        for (const [personId, personBals] of Object.entries(balances)) {
            let combinedAmount = 0;
            for (const [cur, amt] of Object.entries(personBals)) {
                if (cur === targetCurrency) {
                    combinedAmount += amt;
                } else {
                    let rate = 1;
                    if (!isNaN(manualRate)) {
                        rate = manualRate;
                    } else if (cachedExchangeRates && cachedExchangeRates[cur] && cachedExchangeRates[targetCurrency]) {
                        rate = cachedExchangeRates[targetCurrency] / cachedExchangeRates[cur];
                    }
                    combinedAmount += (amt * rate);
                }
            }
            combinedBalances[personId] = { [targetCurrency]: combinedAmount };
        }

        const transactions = simplifyDebts(combinedBalances, targetCurrency);
        container.innerHTML = `
            <h3><i class="fa-solid fa-bolt" style="color:var(--success)"></i> Simplified ${targetCurrency} Settlements</h3>
            <p class="subtitle" style="margin-bottom: 1rem;">All debts converted and minimized to just ${transactions.length} transactions.</p>
            ${renderTxList(transactions, targetCurrency)}
        `;

        renderMemberBreakdown(balances, targetCurrency, manualRate);
    }
}

function renderMemberBreakdown(balances, targetCurrency, manualRate) {
    const activeGroup = getActiveGroup();
    const section = document.getElementById('member-breakdown-section');
    const list = document.getElementById('member-breakdown-list');

    if (!section || !list) return;
    section.classList.remove('hidden');
    list.innerHTML = '';

    activeGroup.people.forEach(person => {
        const personBals = balances[person.id] || {};
        let combinedBalance = 0;
        let detailsHtml = '';

        // Calculate combined balance and build details
        activeGroup.expenses.forEach(e => {
            let payerRecord = null;
            if (e.payers && e.payers.length > 0) {
                payerRecord = e.payers.find(p => p.personId === person.id);
            } else if (e.payerId === person.id) {
                payerRecord = { personId: person.id, amount: e.amount };
            }

            const isPayer = !!payerRecord;
            const participant = e.participants.find(p => p.personId === person.id);

            if (isPayer || participant) {
                let rate = 1;
                if (e.currency !== targetCurrency) {
                    if (!isNaN(manualRate)) {
                        rate = manualRate;
                    } else if (cachedExchangeRates && cachedExchangeRates[e.currency] && cachedExchangeRates[targetCurrency]) {
                        rate = cachedExchangeRates[targetCurrency] / cachedExchangeRates[e.currency];
                    }
                }

                const paid = isPayer ? payerRecord.amount : 0;
                let owed = 0;
                if (participant) {
                    if (e.splitType === 'equal') {
                        owed = e.amount / e.participants.length;
                    } else if (e.splitType === 'exact' || e.splitType === 'paid_for') {
                        owed = participant.share;
                    } else if (e.splitType === 'percent') {
                        owed = (e.amount * participant.share) / 100;
                    } else if (e.splitType === 'shares') {
                        const totalShares = e.participants.reduce((sum, p) => sum + p.share, 0);
                        if (totalShares > 0) {
                            owed = e.amount * (participant.share / totalShares);
                        }
                    }
                }

                const net = paid - owed;
                combinedBalance += (net * rate);

                // Resolve payer names for the 'from' line
                let payerName;
                if (e.payers && e.payers.length > 1) {
                    payerName = e.payers.map(pr => {
                        const person = activeGroup.people.find(p => p.id === pr.personId);
                        return person ? person.name : 'Someone';
                    }).join(' & ');
                } else {
                    const legacyPayerId = (e.payers && e.payers.length > 0) ? e.payers[0].personId : e.payerId;
                    const payerPerson = activeGroup.people.find(p => p.id === legacyPayerId);
                    payerName = payerPerson ? payerPerson.name : 'Someone';
                }

                const paidVal = isPayer ? payerRecord.amount : 0;
                const borrowedVal = (participant && owed > 0) ? owed : 0;

                let paidStr = paidVal > 0 ? `${paidVal.toFixed(2)} <span class="cur-label">${e.currency}</span>` : '<span style="opacity:0.3">-</span>';
                let borrowedStr = borrowedVal > 0 ? `${borrowedVal.toFixed(2)} <span class="cur-label">${e.currency}</span>` : '<span style="opacity:0.3">-</span>';

                if (borrowedVal > 0 && !isPayer) {
                    borrowedStr += `<br><span style="font-size:0.7rem; opacity:0.6;">from ${escapeHTML(payerName)}</span>`;
                }

                detailsHtml += `
                    <div class="expense-row grid-row">
                        <div class="col-desc">
                            <strong>${escapeHTML(e.description)}</strong>
                        </div>
                        <div class="col-paid">
                            <span class="mobile-label">Paid</span>
                            ${paidStr}
                        </div>
                        <div class="col-borrowed">
                            <span class="mobile-label">Borrowed</span>
                            ${borrowedStr}
                        </div>
                        <div class="col-net ${net >= 0 ? 'positive' : 'negative'}">
                            <span class="mobile-label">Net</span>
                            ${(net * rate).toFixed(2)} <span class="cur-label">${targetCurrency}</span>
                        </div>
                    </div>
                `;
            }
        });

        if (detailsHtml === '') return;

        const card = document.createElement('div');
        card.className = 'member-balance-card';
        card.innerHTML = `
            <div class="member-balance-header" onclick="this.nextElementSibling.classList.toggle('collapsed'); this.classList.toggle('expanded');" style="cursor: pointer;">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div class="avatar" style="width:40px; height:40px; font-size:1rem;">${person.name.charAt(0)}</div>
                    <h4 style="margin:0;">${escapeHTML(person.name)}</h4>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <div class="amount ${combinedBalance >= 0 ? 'positive' : 'negative'}" style="font-size:1.2rem; font-weight:800;">
                        ${combinedBalance >= 0 ? '+' : ''}${combinedBalance.toFixed(2)} ${targetCurrency}
                    </div>
                    <i class="fa-solid fa-chevron-down toggle-icon" style="transition: transform 0.3s; color: var(--text-muted); font-size: 0.9rem;"></i>
                </div>
            </div>
            <div class="member-balance-body collapsed">
                <div class="expense-table-header">
                    <div class="col-desc">Expense</div>
                    <div class="col-paid">Paid</div>
                    <div class="col-borrowed">Borrowed</div>
                    <div class="col-net">Net</div>
                </div>
                ${detailsHtml}
            </div>
        `;
        list.appendChild(card);
    });
}

// Call fetch on load
fetchExchangeRate();

// --- PWA Installation Logic ---
let deferredPrompt;
const installBtn = document.getElementById('install-pwa-btn');
const installLoginBtn = document.getElementById('install-pwa-login-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;

    // Show the install buttons
    if (installBtn) installBtn.style.display = 'inline-flex';
    if (installLoginBtn) installLoginBtn.style.display = 'inline-flex';

    console.log("PWA install prompt is ready.");
});

async function handleInstallPrompt() {
    if (deferredPrompt) {
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
        // Hide the buttons
        if (installBtn) installBtn.style.display = 'none';
        if (installLoginBtn) installLoginBtn.style.display = 'none';
    } else {
        // Explicit iOS fallback instruction
        const isIos = () => {
            const userAgent = window.navigator.userAgent.toLowerCase();
            return /iphone|ipad|ipod/.test(userAgent);
        };
        const isStandalone = ('standalone' in window.navigator) && (window.navigator.standalone);

        if (isIos() && !isStandalone) {
            alert("To install on iOS: Tap the 'Share' icon at the bottom of Safari, then select 'Add to Home Screen'.");
        }
    }
}

if (installBtn) installBtn.addEventListener('click', handleInstallPrompt);
if (installLoginBtn) installLoginBtn.addEventListener('click', handleInstallPrompt);

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').then(registration => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

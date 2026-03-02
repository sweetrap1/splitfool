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
let currentUser = null;

// Fallback User ID for offline/unauthenticated users
let myUserId = localStorage.getItem('splitfool_user_id');
if (!myUserId) {
    myUserId = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    localStorage.setItem('splitfool_user_id', myUserId);
}

function getActiveGroup() {
    const group = state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
    return group || { id: 'loading', name: 'Loading...', people: [], expenses: [], creatorId: null };
}

function isGroupAdmin(group) {
    if (!group) return false;
    // If no creatorId at all (legacy), anyone can admin
    if (!group.creatorId) return true;
    // If logged in, check UID
    if (currentUser && group.creatorId === currentUser.uid) return true;
    // If trip was created anonymously on this browser, allow admin
    const localId = localStorage.getItem('splitfool_user_id');
    if (group.creatorId === localId) return true;
    return false;
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
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
        } else {
            console.log("Auth state change: No user");
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
        if (code && code.length === 6) {
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
            alert("Please enter a valid 6-character code.");
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

    // Process URL Invite Links (?join=CODE)
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join')?.toUpperCase();

    let joinedNewGroup = false;
    if (joinCode && joinCode.length === 6) {
        if (!savedGroupIds.includes(joinCode)) {
            const docRef = await db.collection('groups').doc(joinCode).get();
            if (docRef.exists) {
                savedGroupIds.push(joinCode);
                saveSavedGroupIds();
                state.activeGroupId = joinCode;
                joinedNewGroup = true;
                // Clean the URL so a refresh doesn't trigger it again
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                alert(`Invite link invalid: Trip '${joinCode}' was not found.`);
            }
        } else {
            // Already in trip, just switch to it
            state.activeGroupId = joinCode;
            joinedNewGroup = true;
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // Default if no saved groups
    if (savedGroupIds.length === 0) {
        await createNewGroup("My Trip");
    }

    const promises = savedGroupIds.map(id => subscribeToGroup(id));
    await Promise.all(promises);

    // Ensure active group is valid ONLY if we didn't just explicitly join/select one. 
    // Wait for the snapshot to actually populate `state.groups` before defaulting.
    if (!joinedNewGroup && (!state.activeGroupId || !state.groups.find(g => g.id === state.activeGroupId))) {
        state.activeGroupId = state.groups.length > 0 ? state.groups[0].id : null;
    }
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
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
}

function saveState() {
    const activeGroup = getActiveGroup();
    if (activeGroup && activeGroup.id && activeGroup.id !== 'loading' && activeGroup.id !== 'offline_error') {
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
        db.collection('groups').doc(activeGroup.id).set(activeGroup);
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
            document.getElementById('delete-confirm-message').innerHTML = `Are you sure you want to delete the group <strong>"${activeGroup.name}"</strong>?`;
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
            if (code && code.length === 6) {
                if (savedGroupIds.includes(code)) {
                    alert("You are already in this trip.");
                    return;
                }

                const docRef = await db.collection('groups').doc(code).get();
                if (docRef.exists) {
                    savedGroupIds.push(code);
                    saveSavedGroupIds();
                    state.activeGroupId = code;
                    await subscribeToGroup(code);
                    joinGroupModal.classList.remove('active');
                    renderAll();
                } else {
                    alert("Trip code not found.");
                }
            } else {
                alert("Please enter a valid 6-character code.");
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
        `<option value="${g.id}" ${g.id === state.activeGroupId ? 'selected' : ''}>${g.name}</option>`
    ).join('');

    // Toggle Admin Buttons visibility
    const activeGroup = getActiveGroup();
    const isAdmin = isGroupAdmin(activeGroup);

    const editBtn = document.getElementById('edit-group-btn');
    const deleteBtn = document.getElementById('delete-group-btn');

    if (editBtn) editBtn.style.display = isAdmin ? 'flex' : 'none';
    if (deleteBtn) deleteBtn.style.display = isAdmin ? 'flex' : 'none';
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
        document.getElementById('person-name').value = '';
        document.getElementById('person-venmo').value = '';
        personModal.classList.add('active');
    });

    // Add Expense Modal
    const expenseModal = document.getElementById('expense-modal');
    document.getElementById('add-expense-btn').addEventListener('click', () => {
        const activeGroup = getActiveGroup();
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
        document.getElementById('save-edit-person-btn').addEventListener('click', () => {
            const id = editPersonModal.dataset.personId;
            const name = document.getElementById('edit-person-name').value.trim();
            let venmo = document.getElementById('edit-person-venmo').value.trim();

            if (name !== '') {
                const activeGroup = getActiveGroup();
                const person = activeGroup.people.find(p => p.id === id);
                if (person) {
                    person.name = name;
                    if (venmo && !venmo.startsWith('@')) venmo = '@' + venmo;
                    person.venmoUsername = venmo;
                    saveState();
                    renderAll();
                    editPersonModal.classList.remove('active');
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

    document.getElementById('edit-person-name').value = person.name;
    document.getElementById('edit-person-venmo').value = person.venmoUsername || '';
    document.getElementById('edit-person-modal').dataset.personId = id;
    document.getElementById('edit-person-modal').classList.add('active');
};

function addPerson(name, venmo) {
    const activeGroup = getActiveGroup();
    const id = 'p_' + Date.now();
    let venmoUsername = venmo || '';
    if (venmoUsername && !venmoUsername.startsWith('@')) venmoUsername = '@' + venmoUsername;
    activeGroup.people.push({ id, name, venmoUsername });
    saveState();
    renderAll();
}

function removePerson(id) {
    const activeGroup = getActiveGroup();
    // Basic validation: Check if they are involved in any expenses
    const involved = activeGroup.expenses.some(e => e.payerId === id || e.participants.some(p => p.personId === id));
    if (involved) {
        alert('Cannot remove a person involved in expenses.');
        return;
    }
    activeGroup.people = activeGroup.people.filter(p => p.id !== id);
    saveState();
    renderAll();
}

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

    activeGroup.people.forEach(p => {
        const char = p.name.charAt(0).toUpperCase();
        const venmoBadge = p.venmoUsername ? `<span style="color:#008CFF; font-size: 0.8em; margin-left: 0.5rem;"><i class="fa-brands fa-venmo"></i> ${p.venmoUsername}</span>` : '';
        list.innerHTML += `
            <div class="card person-card">
                <div class="person-info">
                    <div class="avatar">${char}</div>
                    <h3>${p.name} ${venmoBadge}</h3>
                </div>
                <div style="display:flex; gap: 0.5rem;">
                    <button class="btn icon-btn" onclick="openEditPersonModal('${p.id}')">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn danger" onclick="removePerson('${p.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

let currentSplitMode = 'equal'; // equal, exact, percent

function resetExpenseForm() {
    const activeGroup = getActiveGroup();
    document.getElementById('expense-desc').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-currency').value = 'USD';

    // Populate payers
    const payerSelect = document.getElementById('expense-payer');
    payerSelect.innerHTML = activeGroup.people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    // Populate participants
    renderSplitParticipants();

    // Reset tabs
    document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.split-tab[data-split="equal"]').classList.add('active');
    currentSplitMode = 'equal';
    updateSplitSummary();
}

function renderSplitParticipants() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('split-participants');

    if (currentSplitMode === 'paid_for') {
        const payerId = document.getElementById('expense-payer').value;
        const otherPeople = activeGroup.people.filter(p => p.id !== payerId);

        container.innerHTML = `
            <div class="form-group" style="margin-top: 1rem;">
                <label>Who did you pay for?</label>
                <select id="paid-for-select" class="participant-input" style="margin-bottom: 1rem;" onchange="updateSplitSummary()">
                    ${otherPeople.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
            </div>
        `;
        return; // Early return for paid_for mode
    }

    container.innerHTML = activeGroup.people.map(p => `
        <div class="participant-card active" id="card_${p.id}" onclick="toggleParticipant('${p.id}')">
            <div class="participant-item-left">
                <input type="checkbox" id="part_${p.id}" class="participant-cb" value="${p.id}" checked style="display:none;" onchange="updateSplitSummary()">
                <div class="participant-avatar">${p.name.charAt(0).toUpperCase()}</div>
                <label for="part_${p.id}" onclick="event.preventDefault()">${p.name}</label>
            </div>
            <div class="participant-input-container" onclick="event.stopPropagation()">
                <input type="number" id="input_${p.id}" class="participant-input" placeholder="0" step="0.01" min="0" 
                    ${currentSplitMode === 'equal' ? 'disabled' : ''} oninput="updateSplitSummary()">
                <span class="split-unit">${currentSplitMode === 'percent' ? '%' : currentSplitMode === 'shares' ? 'shares' : '$'}</span>
            </div>
        </div>
    `).join('');
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

    let currentTotal = 0;
    const checkboxes = document.querySelectorAll('.participant-cb:checked');
    const totalSelected = checkboxes.length;

    document.querySelectorAll('.participant-input').forEach(input => {
        const id = input.id.replace('input_', '');
        const isChecked = document.getElementById('part_' + id).checked;

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
            const val = parseFloat(document.getElementById('input_' + personId).value) || 0;
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
        payerId,
        splitType: currentSplitMode,
        participants
    };

    const activeGroup = getActiveGroup();

    if (existingId) {
        const index = activeGroup.expenses.findIndex(e => e.id === existingId);
        if (index !== -1) {
            activeGroup.expenses[index] = expense;
        }
    } else {
        activeGroup.expenses.push(expense);
    }

    saveState();
    expenseIdInput.value = ''; // Reset
    document.getElementById('expense-modal').classList.remove('active');

    renderAll();
});

window.editExpense = function (id) {
    const activeGroup = getActiveGroup();
    const expense = activeGroup.expenses.find(e => e.id === id);
    if (!expense) return;

    // Open modal
    document.getElementById('expense-modal').classList.add('active');
    document.getElementById('expense-modal-title').textContent = 'Edit Expense';

    // Fill fields
    document.getElementById('expense-id').value = id;
    document.getElementById('expense-desc').value = expense.description;
    document.getElementById('expense-amount').value = expense.amount;
    document.getElementById('expense-currency').value = expense.currency;
    document.getElementById('expense-payer').value = expense.payerId;

    // Set split mode
    currentSplitMode = expense.splitType;
    document.querySelectorAll('.split-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-split') === currentSplitMode);
    });

    renderSplitParticipants();

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
    activeGroup.expenses = activeGroup.expenses.filter(e => e.id !== id);

    saveState();
    renderAll();
};

function renderExpenses() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('expense-list');
    list.innerHTML = '';

    if (activeGroup.expenses.length === 0) {
        list.innerHTML = '<p class="subtitle">No expenses added yet.</p>';
        return;
    }

    // Sort descending by id (newest first)
    const sorted = [...activeGroup.expenses].sort((a, b) => b.id.localeCompare(a.id));

    sorted.forEach(e => {
        const payer = activeGroup.people.find(p => p.id === e.payerId)?.name || 'Unknown';
        const symbol = e.currency === 'USD' ? '<i class="fa-solid fa-dollar-sign"></i>' : (e.currency === 'MXN' ? '<i class="fa-solid fa-peso-sign"></i>' : e.currency);

        const participantNames = e.participants.map(part => {
            const person = activeGroup.people.find(p => p.id === part.personId);
            return person ? person.name : 'Unknown';
        }).join(', ');

        list.innerHTML += `
            <div class="card expense-card" id="exp_${e.id}">
                <div class="expense-header">
                    <div style="flex:1">
                        <h3>${e.description}</h3>
                    </div>
                    <div class="amount">${symbol} ${e.amount.toFixed(2)}</div>
                    <div class="expense-actions">
                        <button class="expense-action-btn edit" onclick="editExpense('${e.id}')" title="Edit Expense">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="expense-action-btn delete" onclick="deleteExpense('${e.id}')" title="Delete Expense">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="expense-details">
                    <span class="payer-badge">Paid by ${payer}</span>
                    <span class="split-info">For: ${participantNames} (${e.splitType})</span>
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
        if (balances[e.payerId]) {
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

            if (!balances[p.personId][cur]) balances[p.personId][cur] = 0;
            balances[p.personId][cur] -= debt;
        });
    });

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

        list.innerHTML += `
            <div class="card person-card">
                <div class="person-info">
                    <div class="avatar">${p.name.charAt(0).toUpperCase()}</div>
                    <div>
                        <h3>${p.name}</h3>
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
document.getElementById('exchange-rate')?.addEventListener('input', renderSettleUp);
document.getElementById('settle-mode')?.addEventListener('change', renderSettleUp);

function renderSettleUp() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('settle-results-container');
    const modeSelect = document.getElementById('settle-mode');
    if (!container || !modeSelect) return; // fail safe

    container.innerHTML = '';

    if (activeGroup.people.length === 0 || activeGroup.expenses.length === 0) {
        container.innerHTML = '<div><p class="subtitle">No debts to settle.</p></div>';
        return;
    }

    const balances = calculateBalances();

    // 1. Find all unique currencies used in this group
    const usedCurrencies = new Set();
    for (const [personId, personBals] of Object.entries(balances)) {
        for (const [cur, amt] of Object.entries(personBals)) {
            if (Math.abs(amt) > 0.01) usedCurrencies.add(cur);
        }
    }

    // Fallback if somehow no debts
    if (usedCurrencies.size === 0) {
        container.innerHTML = '<div class="card" style="text-align:center; padding: 1rem;">All settled up! 🎉</div>';
        return;
    }

    // 2. Populate the Settle Mode dropdown
    const currentMode = modeSelect.value;
    let optionsHtml = '<option value="separate">Separate Currencies</option>';

    // Always offer major world currencies to combine into, plus any extras used
    let availableTargets;
    if (cachedExchangeRates) {
        availableTargets = new Set(Object.keys(cachedExchangeRates).sort());
    } else {
        availableTargets = new Set(['USD', 'MXN', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', ...usedCurrencies]);
    }

    availableTargets.forEach(cur => {
        optionsHtml += `<option value="${cur}">${getCurrencyLabel(cur)}</option>`;
    });

    // Only rewrite innerHTML if it has actually changed to prevent resetting the dropdown constantly
    if (modeSelect.innerHTML !== optionsHtml) {
        modeSelect.innerHTML = optionsHtml;
    }

    // Restore selection if valid, else default
    if (['separate', ...availableTargets].includes(currentMode)) {
        modeSelect.value = currentMode;
    } else {
        modeSelect.value = 'separate';
    }

    const activeMode = modeSelect.value;

    const renderTxList = (transactions, currency) => {
        if (transactions.length === 0) return '';
        let html = '<ul class="settle-list">';
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
                <li style="list-style:none;">
                    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center;">
                            <strong>${fromName}</strong>&nbsp;pays&nbsp;<strong>${toName}</strong>
                            ${venmoBtn}
                        </div>
                        <div class="amount positive">${tx.amount.toFixed(2)} ${currency}</div>
                    </div>
                </li>
            `;
        });
        html += '</ul>';
        return html;
    };

    if (activeMode === 'separate') {
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
        // Combined mode
        const targetCurrency = activeMode;

        // Ensure we have rates
        if (!cachedExchangeRates) {
            container.innerHTML = '<div class="card" style="color:var(--danger)">Loading live exchange rates... Please try again in a moment.</div>';
            return;
        }

        let conversionSummary = '';
        usedCurrencies.forEach(cur => {
            if (cur !== targetCurrency && cachedExchangeRates[cur] && cachedExchangeRates[targetCurrency]) {
                const rate = cachedExchangeRates[targetCurrency] / cachedExchangeRates[cur];
                conversionSummary += `<li>1 ${cur} = ${rate.toFixed(4)} ${targetCurrency}</li>`;
            }
        });

        // Convert all balances to target currency first
        const combinedBalances = {};

        for (const [personId, personBals] of Object.entries(balances)) {
            let combinedAmount = 0;
            for (const [cur, amt] of Object.entries(personBals)) {
                if (cur === targetCurrency) {
                    combinedAmount += amt;
                } else if (cachedExchangeRates[cur] && cachedExchangeRates[targetCurrency]) {
                    // Convert from 'cur' to USD, then USD to 'targetCurrency'
                    const amountInUSD = amt / cachedExchangeRates[cur];
                    const amountInTarget = amountInUSD * cachedExchangeRates[targetCurrency];
                    combinedAmount += amountInTarget;
                }
            }
            combinedBalances[personId] = { [targetCurrency]: combinedAmount };
        }

        const transactions = simplifyDebts(combinedBalances, targetCurrency);

        container.innerHTML = `
            <h3><i class="fa-solid fa-earth-americas"></i> Combined ${targetCurrency} Settlements</h3>
            ${conversionSummary ? `
                <div class="subtitle" style="margin-bottom: 1rem; font-size: 0.85rem;">
                    <strong><i class="fa-solid fa-bolt" style="color:var(--success)"></i> Live Rates Applied:</strong>
                    <ul style="margin: 0.25rem 0 0 1.5rem; color: var(--text-muted);">
                        ${conversionSummary}
                    </ul>
                </div>
            ` : ''}
            ${renderTxList(transactions, targetCurrency)}
        `;
    }
}

// Call fetch on load
fetchExchangeRate();

function resetExpenseForm() {
    document.getElementById('expense-id').value = '';
    document.getElementById('expense-modal-title').textContent = 'Add Expense';
    document.getElementById('expense-desc').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-currency').value = 'USD';

    const activeGroup = getActiveGroup();
    if (activeGroup.people.length > 0) {
        document.getElementById('expense-payer').value = activeGroup.people[0].id;
    }

    currentSplitMode = 'equal';
    document.querySelectorAll('.split-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-split') === 'equal');
    });

    renderSplitParticipants();
    updateSplitSummary();
}

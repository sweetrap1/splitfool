// Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyArL1xQgclF0tshvGoZPRmIlCSfzr0TAps",
    // IMPORTANT: Use web.app as authDomain, NOT firebaseapp.com.
    // Firebase v8 uses a cross-origin iframe to firebaseapp.com to store/retrieve
    // redirect auth credentials. Safari ITP blocks this cross-origin iframe storage,
    // causing getRedirectResult() to always return null on iOS — putting users back
    // at the login screen after a successful Google sign-in.
    // Using web.app keeps auth storage same-origin, which Safari allows.
    // web.app/__/auth/handler is now registered in Google Cloud Console.
    authDomain: "splitfool-4ca6b.web.app",
    projectId: "splitfool-4ca6b",
    storageBucket: "splitfool-4ca6b.firebasestorage.app",
    messagingSenderId: "544504211257",
    appId: "1:544504211257:web:94d93ff317d28d91ebeae8",
    measurementId: "G-C7HF3N3X7N"
};

if (!window.firebase.apps.length) {
    window.firebase.initializeApp(firebaseConfig);
}

export const auth = window.firebase.auth();
export const provider = new window.firebase.auth.GoogleAuthProvider();
export const db = window.firebase.firestore();

// Set auth persistence once at init time (not per-login call).
// LOCAL persistence uses IndexedDB which survives page reloads.
// Must be done before any sign-in attempt.
auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.warn('Auth persistence setup failed:', err.message));

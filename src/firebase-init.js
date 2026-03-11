// Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyArL1xQgclF0tshvGoZPRmIlCSfzr0TAps",
    // Keep authDomain as firebaseapp.com — Firebase uses this domain to handle
    // the OAuth flow and it must match an authorized domain in Firebase Console.
    // The iOS fix is handled separately via signInWithRedirect on Safari/iOS.
    authDomain: "splitfool-4ca6b.firebaseapp.com",
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

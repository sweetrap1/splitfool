// Auth UI Component

import { loginWithPopup, loginWithRedirect, logout, joinGroupWithCode } from '../../api/auth.js';
import { state } from '../../state.js';

export function initAuthUI(onAuthChange, renderAll) {
    const loginHandler = async () => {
        showAuthStatus("Initializing Google Login...", "");
        const googleBtn = document.getElementById('google-login-btn');
        if (googleBtn) googleBtn.disabled = true;

        try {
            await loginWithPopup();
        } catch (error) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
                showAuthStatus("Popup blocked. Redirecting...", "");
                loginWithRedirect().catch(err => {
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
            try {
                await joinGroupWithCode(code);
                document.getElementById('auth-overlay')?.classList.add('hidden');
                document.querySelector('.app-container')?.classList.remove('hidden');
                state.activeGroupId = code;
                renderAll();
            } catch (err) {
                alert(err.message);
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
        logout();
    });
}

export function showAuthStatus(message, type = "", duration = 0) {
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

export function handleAuthError(error) {
    console.error("Login Error:", error);
    showAuthStatus(`Error: ${error.message}`, "error");

    let msg = `Login Failed: ${error.message}`;

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

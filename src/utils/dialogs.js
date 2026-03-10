/**
 * Custom Dialog Utility for SplitFool
 * Replaces native alert() and confirm() with stylized modals.
 *
 * Fixed: dialogResolve is now guarded so overlapping calls don't
 * silently drop the first promise. The previous resolve is rejected
 * before a new dialog opens.
 */

const modal = document.getElementById('custom-dialog-modal');
const titleEl = document.getElementById('dialog-title');
const messageEl = document.getElementById('dialog-message');
const iconEl = document.getElementById('dialog-icon');
const cancelBtn = document.getElementById('dialog-cancel-btn');
const confirmBtn = document.getElementById('dialog-confirm-btn');
const dialogFooter = confirmBtn?.closest('.modal-footer');

let dialogResolve = null;

function _openDialog(title, message, options = {}) {
    return new Promise((resolve) => {
        // If a dialog is already open, reject the previous promise so it doesn't hang
        if (dialogResolve) {
            dialogResolve(false);
        }

        titleEl.textContent = title || 'Are you sure?';
        messageEl.textContent = message || '';
        confirmBtn.textContent = options.confirmText || 'Confirm';
        cancelBtn.textContent = options.cancelText || 'Cancel';

        // Safely set icon class — never interpolate user-provided strings into innerHTML
        const iconClass = /^[\w-]+$/.test(options.icon || '') ? options.icon : 'fa-circle-question';
        iconEl.innerHTML = '';
        const iconI = document.createElement('i');
        iconI.className = `fa-solid ${iconClass}`;
        iconEl.appendChild(iconI);
        iconEl.style.color = options.danger ? 'var(--danger)' : 'var(--primary)';

        if (options.danger) {
            confirmBtn.style.background = 'var(--danger)';
            confirmBtn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
        } else {
            confirmBtn.style.background = '';
            confirmBtn.style.boxShadow = '';
        }

        dialogResolve = resolve;
        modal.classList.add('active');
    });
}

export function showConfirm(title, message, options = {}) {
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (dialogFooter) dialogFooter.style.justifyContent = 'flex-end';
    return _openDialog(title, message, options);
}

export function showAlert(title, message, options = {}) {
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (dialogFooter) dialogFooter.style.justifyContent = 'center';
    if (confirmBtn) confirmBtn.textContent = options.confirmText || 'OK';
    return _openDialog(title, message, { ...options, confirmText: options.confirmText || 'OK' });
}

// Global listeners for the dialog buttons
if (cancelBtn) {
    cancelBtn.onclick = () => {
        modal.classList.remove('active');
        if (dialogResolve) { dialogResolve(false); dialogResolve = null; }
    };
}

if (confirmBtn) {
    confirmBtn.onclick = () => {
        modal.classList.remove('active');
        if (dialogResolve) { dialogResolve(true); dialogResolve = null; }
    };
}

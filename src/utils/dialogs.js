/**
 * Custom Dialog Utility for SplitFool
 * Replaces native alert() and confirm() with stylized modals.
 */

const modal = document.getElementById('custom-dialog-modal');
const titleEl = document.getElementById('dialog-title');
const messageEl = document.getElementById('dialog-message');
const iconEl = document.getElementById('dialog-icon');
const cancelBtn = document.getElementById('dialog-cancel-btn');
const confirmBtn = document.getElementById('dialog-confirm-btn');

let dialogResolve = null;

export function showConfirm(title, message, options = {}) {
    return new Promise((resolve) => {
        titleEl.textContent = title || 'Are you sure?';
        messageEl.textContent = message || '';
        confirmBtn.textContent = options.confirmText || 'Confirm';
        cancelBtn.textContent = options.cancelText || 'Cancel';
        cancelBtn.style.display = 'inline-flex';

        // Icon handling
        iconEl.innerHTML = `<i class="fa-solid ${options.icon || 'fa-circle-question'}"></i>`;
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

export function showAlert(title, message, options = {}) {
    return new Promise((resolve) => {
        titleEl.textContent = title || 'Notice';
        messageEl.textContent = message || '';
        confirmBtn.textContent = options.confirmText || 'OK';
        cancelBtn.style.display = 'none';

        iconEl.innerHTML = `<i class="fa-solid ${options.icon || 'fa-circle-info'}"></i>`;
        iconEl.style.color = 'var(--primary)';
        confirmBtn.style.background = '';
        confirmBtn.style.boxShadow = '';

        dialogResolve = resolve;
        modal.classList.add('active');
    });
}

// Global listeners for the dialog buttons
if (cancelBtn) {
    cancelBtn.onclick = () => {
        modal.classList.remove('active');
        if (dialogResolve) dialogResolve(false);
    };
}

if (confirmBtn) {
    confirmBtn.onclick = () => {
        modal.classList.remove('active');
        if (dialogResolve) dialogResolve(true);
    };
}

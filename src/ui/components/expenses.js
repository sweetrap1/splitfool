// Expenses UI Component

import { deleteExpense, addExpense, editExpense } from '../../api/expenses.js';
import { addRecurringExpense, deleteRecurringExpense, toggleRecurringExpenseActive, nextRecurringDate } from '../../api/recurring.js';
import { getActiveGroup, state } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';
import { showConfirm, showAlert } from '../../utils/dialogs.js';
import { updateModalBodyClass } from '../navigation.js';

let currentPayerMode = 'single'; // 'single' or 'multiple'
let currentSplitMode = 'equal'; // equal, exact, percent, shares, paid_for
let _renderAll = () => {}; // Captured from initExpensesUI so deleteExpenseUI can use it

export function initExpensesUI(renderAll) {
    _renderAll = renderAll; // Capture so module-level functions can call it
    const addExpenseBtn = document.getElementById('add-expense-btn');
    const expenseModal = document.getElementById('expense-modal');

    // Bind globals for inline onclick functionality
    window.editExpenseUI = editExpenseUI;
    window.deleteExpenseUI = deleteExpenseUI;
    window.toggleParticipant = toggleParticipant;
    window.togglePayerMode = togglePayerMode;
    window.updateMultiplePayersSummary = updateMultiplePayersSummary;
    window.updateSplitSummary = updateSplitSummary;
    window.deleteRecurringUI = deleteRecurringUI;
    window.toggleRecurringActiveUI = toggleRecurringActiveUI;

    const recurringCheckbox = document.getElementById('expense-recurring');
    if (recurringCheckbox) {
        recurringCheckbox.addEventListener('change', () => {
            const recurringOptions = document.getElementById('recurring-options');
            if (recurringOptions) recurringOptions.classList.toggle('hidden', !recurringCheckbox.checked);
        });
    }

    if (addExpenseBtn && expenseModal) {
        addExpenseBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            if (!activeGroup || activeGroup.people.length === 0) {
                showAlert('No People', "Please add at least 2 people first.", { icon: 'fa-users-slash' });
                return;
            }
            if (activeGroup.isLocked) {
                showAlert('Trip Locked', "This trip is locked. No new expenses can be added.", { icon: 'fa-lock' });
                return;
            }

            resetExpenseForm();
            expenseModal.classList.add('active');
            updateModalBodyClass();
        });

        document.getElementById('save-expense-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            const desc = document.getElementById('expense-desc').value.trim();
            const amount = parseFloat(document.getElementById('expense-amount').value);
            const currency = document.getElementById('expense-currency')?.value || 'USD';
            const expenseIdInput = document.getElementById('expense-id');
            const existingId = expenseIdInput.value;

            if (!desc || isNaN(amount) || amount === 0) {
                showAlert('Invalid Amount', 'Please enter a description and a non-zero amount. Use a negative amount for a refund.', { icon: 'fa-circle-exclamation' });
                return;
            }

            let payers = [];
            if (currentPayerMode === 'single') {
                const payerId = document.getElementById('expense-payer').value;
                if (!payerId) {
                    showAlert('No Payer', "Please select who paid.", { icon: 'fa-user-slash' });
                    return;
                }
                payers.push({ personId: payerId, amount: amount });
            } else {
                const summaryEl = document.getElementById('multiple-payers-summary');
                if (summaryEl && summaryEl.classList.contains('error')) {
                    showAlert('Math Error', 'The multiple payers total does not match the expense amount.', { icon: 'fa-calculator' });
                    return;
                }
                const multiPayerContainer = document.getElementById('multiple-payers-list');
                if (multiPayerContainer) {
                    multiPayerContainer.querySelectorAll('.multi-payer-input').forEach(input => {
                        const val = parseFloat(input.value) || 0;
                        if (val > 0) {
                            const personId = input.id.replace('mp_', '');
                            payers.push({ personId, amount: val });
                        }
                    });
                }
                if (payers.length === 0) {
                    showAlert('No Payers', 'Please specify who paid for this expense.', { icon: 'fa-user-slash' });
                    return;
                }
            }

            const participants = [];
            if (currentSplitMode === 'paid_for') {
                const owedById = document.getElementById('paid-for-select').value;
                if (!owedById) {
                    showAlert('No Participant', 'Please select who you paid for.', { icon: 'fa-user-slash' });
                    return;
                }
                participants.push({ personId: owedById, share: amount });
            } else {
                const splitContainer = document.getElementById('split-participants');
                const checkboxes = splitContainer ? splitContainer.querySelectorAll('.participant-cb:checked') : [];
                if (checkboxes.length === 0) {
                    showAlert('No Participants', 'Please select at least one participant.', { icon: 'fa-users-slash' });
                    return;
                }

                const summaryEl = document.getElementById('split-summary');
                if (summaryEl && summaryEl.classList.contains('error')) {
                    showAlert('Math Error', 'The assigned splits do not add up to the total.', { icon: 'fa-calculator' });
                    return;
                }

                checkboxes.forEach(cb => {
                    const personId = cb.value;
                    let val;
                    if (currentSplitMode === 'equal') {
                        val = amount / checkboxes.length;
                    } else {
                        val = parseFloat(document.getElementById('input_' + personId).value) || 0;
                    }
                    participants.push({ personId, share: val });
                });
            }

            const recurringCheckbox = document.getElementById('expense-recurring');
            const makeRecurring = !existingId && recurringCheckbox && recurringCheckbox.checked;
            const frequency = document.getElementById('expense-recurring-frequency')?.value || 'monthly';
            // Shared ID linking this expense to its recurring template, so the
            // UI can badge them as related instead of looking like duplicates.
            const recurringId = makeRecurring ? ('rec_' + Date.now()) : null;

            const expenseData = {
                id: existingId || 'e_' + crypto.randomUUID(),
                description: desc,
                amount,
                currency,
                payerId: payers[0].personId, // fallback for legacy clients
                payers: payers,
                splitType: currentSplitMode,
                participants,
                ...(recurringId ? { recurringId } : {})
            };

            const saveBtn = document.getElementById('save-expense-btn');
            saveBtn.disabled = true;
            try {
                if (existingId) {
                    await editExpense(existingId, expenseData);
                } else {
                    await addExpense(expenseData);
                }
                if (makeRecurring) {
                    await addRecurringExpense({
                        description: desc,
                        amount,
                        currency,
                        payerId: payers[0].personId,
                        payers,
                        splitType: currentSplitMode,
                        participants,
                        frequency,
                        nextDate: nextRecurringDate(frequency)
                    }, recurringId);
                }
                expenseModal.classList.remove('active');
                updateModalBodyClass();
            } catch (err) {
                showAlert('Error', "Error saving expense: " + err.message, { icon: 'fa-circle-exclamation' });
                console.error(err);
            } finally {
                saveBtn.disabled = false;
                renderAll();
            }
        });

        // Split-mode tabs event listeners (Equal/Exact/Percent/Shares/Paid For).
        // Scoped to .split-mode-tab so this doesn't collide with the Single/Multiple
        // payer buttons, which also carry the shared .split-tab class.
        document.querySelectorAll('.split-mode-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.split-mode-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentSplitMode = e.target.getAttribute('data-split');

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
    }
}

export function resetExpenseForm() {
    const expenseModal = document.getElementById('expense-modal');
    if (!expenseModal) return;

    document.getElementById('expense-id').value = '';
    document.getElementById('expense-modal-title').textContent = 'Add Expense';
    document.getElementById('expense-desc').value = '';
    document.getElementById('expense-amount').value = '';
    const activeGroup = getActiveGroup();
    document.getElementById('expense-currency').value = activeGroup.defaultCurrency || 'USD';

    togglePayerMode('single');
    updatePayerDropdown();

    // Reset split mode to equal BEFORE rendering participants, so the initial
    // render doesn't use a stale currentSplitMode (e.g. 'paid_for') left over
    // from the last expense added/edited.
    document.querySelectorAll('.split-mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.split-mode-tab[data-split="equal"]').classList.add('active');
    currentSplitMode = 'equal';

    document.getElementById('split-participants').innerHTML = '';
    renderSplitParticipants();
    updateSplitSummary();

    // Recurring is only offered when creating a brand new expense
    const recurringGroup = document.getElementById('recurring-toggle-group');
    if (recurringGroup) recurringGroup.classList.remove('hidden');
    const recurringCheckbox = document.getElementById('expense-recurring');
    if (recurringCheckbox) recurringCheckbox.checked = false;
    const recurringOptions = document.getElementById('recurring-options');
    if (recurringOptions) recurringOptions.classList.add('hidden');
    const recurringFrequency = document.getElementById('expense-recurring-frequency');
    if (recurringFrequency) recurringFrequency.value = 'monthly';
}

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

    renderMultiplePayers();
}

export function togglePayerMode(mode) {
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
}

export function updateMultiplePayersSummary() {
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
}

function renderMultiplePayers() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('multiple-payers-list');
    if (!container || !activeGroup || !activeGroup.people) return;

    // Use the actual selected expense currency, not a hardcoded '$'
    const currencyCode = document.getElementById('expense-currency')?.value || 'USD';
    let currencySymbol = '$';
    try {
        const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode })
            .formatToParts(0);
        currencySymbol = parts.find(p => p.type === 'currency')?.value || currencyCode;
    } catch (e) { currencySymbol = currencyCode; }

    const currentValues = {};
    container.querySelectorAll('.multi-payer-input').forEach(input => {
        const id = input.id.replace('mp_', '');
        currentValues[id] = input.value;
    });

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
                <input type="number" id="mp_${safeId}" class="multi-payer-input" placeholder="0" step="0.01" value="${prevValue}" oninput="updateMultiplePayersSummary()">
                <span class="split-unit">${currencySymbol}</span>
            </div>
        </div>
        `;
    }).join('');

    updateMultiplePayersSummary();
}

function renderSplitParticipants() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('split-participants');
    if (!container || !activeGroup) return;

    const currentStates = {};
    const currentValues = {};
    container.querySelectorAll('.participant-cb').forEach(cb => {
        const id = cb.id.replace('part_', '');
        currentStates[id] = cb.checked;
    });
    container.querySelectorAll('.participant-input').forEach(input => {
        const id = input.id.replace('input_', '');
        currentValues[id] = input.value;
    });

    if (currentSplitMode === 'paid_for') {
        const payerId = document.getElementById('expense-payer').value;
        const otherPeople = activeGroup.people.filter(p => p.id !== payerId);

        container.innerHTML = `
            <div class="form-group" style="margin-top: 1rem;">
                <label>Paid For</label>
                <select id="paid-for-select" class="participant-input" style="margin-bottom: 1rem;" onchange="updateSplitSummary()">
                    ${otherPeople.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
                </select>
            </div>
        `;
        return;
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
                <input type="number" id="input_${safeId}" class="participant-input" placeholder="0" step="0.01" value="${prevValue}"
                    ${currentSplitMode === 'equal' ? 'disabled' : ''} oninput="updateSplitSummary()">
                <span class="split-unit">${splitUnit}</span>
            </div>
        </div>
    `}).join('');
}

export function toggleParticipant(id) {
    const splitContainer = document.getElementById('split-participants');
    if (!splitContainer) return;

    const cb = splitContainer.querySelector(`[id="part_${id}"]`);
    const card = splitContainer.querySelector(`[id="card_${id}"]`);
    if (!cb || !card) return;

    cb.checked = !cb.checked;
    card.classList.toggle('active', cb.checked);
    updateSplitSummary();
}

function updateSplitSummary() {
    const expenseAmountInput = document.getElementById('expense-amount');
    if (!expenseAmountInput) return;
    const totalAmount = parseFloat(expenseAmountInput.value) || 0;

    const totalDisplay = document.getElementById('expense-total-display');
    if (totalDisplay) totalDisplay.textContent = totalAmount.toFixed(2);

    const splitContainer = document.getElementById('split-participants');
    if (!splitContainer) return;

    const checkboxes = splitContainer.querySelectorAll('.participant-cb:checked');
    const totalSelected = checkboxes.length;

    splitContainer.querySelectorAll('.participant-input').forEach(input => {
        const id = input.id.replace('input_', '');
        const cbEl = splitContainer.querySelector(`[id="part_${id}"]`);
        if (!cbEl) return;
        const isChecked = cbEl.checked;

        if (!isChecked) {
            input.value = '';
            input.disabled = true;
            return;
        }

        input.disabled = currentSplitMode === 'equal';
    });

    let currentTotal = 0;
    if (currentSplitMode === 'equal') {
        if (totalSelected > 0) {
            const splitAmount = totalAmount / totalSelected;
            checkboxes.forEach(cb => {
                const input = document.getElementById('input_' + cb.value);
                if (input) input.value = splitAmount.toFixed(2);
            });
            currentTotal = totalAmount;
        }
    } else if (currentSplitMode !== 'paid_for') {
        checkboxes.forEach(cb => {
            const input = document.getElementById('input_' + cb.value);
            if (input) currentTotal += parseFloat(input.value) || 0;
        });
    }

    const summaryEl = document.getElementById('split-summary');
    const totalEl = document.getElementById('split-total-amount');

    if (totalEl) {
        if (currentSplitMode === 'percent') {
            totalEl.textContent = currentTotal.toFixed(1) + '%';
            summaryEl?.classList.toggle('error', Math.abs(currentTotal - 100) > 0.1 && checkboxes.length > 0);
        } else if (currentSplitMode === 'shares') {
            totalEl.textContent = currentTotal.toFixed(1) + ' shares';
            summaryEl?.classList.remove('error');
        } else if (currentSplitMode === 'equal') {
            totalEl.textContent = totalAmount.toFixed(2);
            summaryEl?.classList.remove('error');
        } else if (currentSplitMode === 'paid_for') {
            // Handled separately
        } else {
            totalEl.textContent = currentTotal.toFixed(2);
            summaryEl?.classList.toggle('error', Math.abs(currentTotal - totalAmount) > 0.05 && checkboxes.length > 0);
        }
    }
}

function renderRecurringExpenses() {
    const activeGroup = getActiveGroup();
    const section = document.getElementById('recurring-section');
    const list = document.getElementById('recurring-list');
    if (!section || !list) return;

    const recurring = activeGroup.recurringExpenses || [];
    if (recurring.length === 0) {
        section.classList.add('hidden');
        list.innerHTML = '';
        return;
    }

    section.classList.remove('hidden');

    list.innerHTML = recurring.map(r => {
        const safeId = escapeHTML(r.id);
        const safeDesc = escapeHTML(r.description);
        const safeCurrency = escapeHTML(r.currency);
        const safeFrequency = escapeHTML(r.frequency);
        const nextDate = r.nextDate ? new Date(r.nextDate + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

        return `
            <div class="card expense-card recurring-template-card" id="rec_${safeId}" style="border-left: 3px solid var(--primary); background: rgba(var(--primary-rgb), 0.05); ${r.active ? '' : 'opacity: 0.55;'}">
                <div class="expense-header">
                    <div style="flex:1">
                        <h3><i class="fa-solid fa-rotate" style="font-size: 0.8em; color: var(--primary); margin-right: 6px;"></i>${safeDesc}</h3>
                        <div style="color: var(--text-muted); font-size: 0.85em; margin-top: 4px; text-transform: capitalize;">
                            ${safeFrequency}${r.active ? ` &middot; Next: ${nextDate}` : ' &middot; Paused'}
                        </div>
                    </div>
                    <div class="amount">${safeCurrency} ${Number(r.amount).toFixed(2)}</div>
                    <div class="expense-actions">
                        <button class="expense-action-btn edit" onclick="toggleRecurringActiveUI('${safeId}')" title="${r.active ? 'Pause' : 'Resume'}">
                            <i class="fa-solid ${r.active ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button class="expense-action-btn delete" onclick="deleteRecurringUI('${safeId}')" title="Delete Recurring Expense">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function deleteRecurringUI(id) {
    showConfirm('Delete Recurring Expense', 'Stop this recurring expense? Future occurrences will no longer be added automatically.', {
        danger: true,
        confirmText: 'Delete',
        icon: 'fa-trash-can'
    }).then((confirmed) => {
        if (confirmed) {
            deleteRecurringExpense(id).then(_renderAll).catch(e => console.error("Error deleting recurring expense", e));
        }
    });
}

function toggleRecurringActiveUI(id) {
    toggleRecurringExpenseActive(id).then(_renderAll).catch(e => console.error("Error toggling recurring expense", e));
}

export function renderExpenses() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('expense-list');
    if (!list) return;

    renderRecurringExpenses();

    list.innerHTML = '';

    const addExpenseBtn = document.getElementById('add-expense-btn');
    if (activeGroup.isLocked) {
        if (addExpenseBtn) addExpenseBtn.style.display = 'none';
        list.innerHTML = `
            <div class="card" style="margin-bottom: 1rem; text-align: center; border: 1px solid var(--warning); background: rgba(255,193,7,0.05);">
                <span style="color: var(--warning); font-weight: bold;"><i class="fa-solid fa-lock"></i> Trip is Locked</span>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; margin-bottom: 0;">This group has been moved to the Settle Up phase. No new expenses can be added.</p>
            </div>
        `;
    } else {
        if (addExpenseBtn) addExpenseBtn.style.display = 'inline-flex';
    }

    const allExpenses = activeGroup.expenses.filter(e => !e.isSettlement && !e.id?.startsWith('set_'));
    const activeExpenses = allExpenses.filter(e => !e.isArchived);
    const archivedExpenses = allExpenses.filter(e => e.isArchived);

    const countDisplay = document.getElementById('expense-count-display');
    if (countDisplay) {
        const count = activeExpenses.length;
        countDisplay.textContent = count > 0 ? `(${count})` : '';
    }

    if (activeExpenses.length === 0 && archivedExpenses.length === 0) {
        list.innerHTML += `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                <i class="fa-solid fa-receipt" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.3; display: block;"></i>
                <div style="font-weight: 600; margin-bottom: 0.4rem; color: var(--text-main);">No expenses yet</div>
                <div style="font-size: 0.85rem;">Add your first expense to get started.</div>
            </div>
        `;
        return;
    }

    if (activeExpenses.length === 0) {
        list.innerHTML += `
            <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                <i class="fa-solid fa-check-circle" style="font-size: 2rem; margin-bottom: 0.75rem; opacity: 0.4; display: block; color: var(--success);"></i>
                <div style="font-size: 0.9rem;">All expenses archived — start fresh below.</div>
            </div>
        `;
    }

    // Helper to build an expense card HTML
    function buildExpenseCard(e, isArchived) {
        // Name lookup — falls back to formerMembers if someone left the group
        const findName = (id) => {
            const p = activeGroup.people.find(p => p.id === id);
            if (p) return p.name;
            const fm = (activeGroup.formerMembers || []).find(fm => fm.id === id);
            return fm ? `${fm.name} (left)` : 'Unknown';
        };

        let payerText = '';
        if (e.payers && e.payers.length > 1) {
            const payerNames = e.payers.map(p => findName(p.personId));
            payerText = escapeHTML(payerNames.join(', '));
        } else {
            payerText = escapeHTML(findName(e.payerId || e.paidBy));
        }

        const symbol = escapeHTML(e.currency || 'USD');

        let participantNames;
        if (e.participants.length === activeGroup.people.length && activeGroup.people.length > 0) {
            participantNames = 'All';
        } else {
            const names = e.participants.map(part => findName(part.personId));
            participantNames = escapeHTML(names.join(', ')) + ` <span style="color: var(--primary); font-weight: bold;">(${e.participants.length})</span>`;
        }

        const safeDesc = escapeHTML(e.description);
        const safeId = escapeHTML(e.id);
        const safeSplit = escapeHTML(e.splitType || e.splitMode || 'equal');

        let actionButtons = '';
        if (!isArchived && !activeGroup.isLocked) {
            actionButtons = `
                <button class="expense-action-btn edit" onclick="editExpenseUI('${safeId}')" title="Edit Expense">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="expense-action-btn delete" onclick="deleteExpenseUI('${safeId}')" title="Delete Expense">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
        }

        let perPersonHtml = '';
        if (safeSplit === 'equal') {
            const count = e.participants.length;
            if (count > 0) {
                const share = e.amount / count;
                perPersonHtml = `<span class="share-badge" style="background: rgba(var(--primary-rgb), 0.1); border: 1px solid rgba(var(--primary-rgb), 0.2); color: var(--primary); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">${symbol} ${share.toFixed(2)} each</span>`;
            }
        }

        const detailsHtml = `
            <div class="expense-details" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
                <div class="payer-badge" style="color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                    <span>Paid by <strong>${payerText}</strong></span>
                    ${perPersonHtml}
                </div>
                <div class="split-info" style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--text-muted); font-size: 0.9em;">
                    <span>For: ${participantNames}</span>
                    <span class="split-badge" style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; text-transform: capitalize; color: var(--text-main);">
                        ${safeSplit.replace('_', ' ')}
                    </span>
                </div>
            </div>
        `;

        const archivedClass = isArchived ? ' expense-archived' : '';
        const archivedBadge = isArchived ? `<span style="font-size: 0.7rem; color: var(--text-muted); background: rgba(255,255,255,0.06); border-radius: 8px; padding: 2px 8px; margin-left: 6px; font-weight: 600; letter-spacing: 0.5px;"><i class="fa-solid fa-box-archive" style="margin-right: 3px;"></i>Archived</span>` : '';
        // Marks this expense as linked to a recurring template, so it doesn't
        // read as an unrelated duplicate of the card in the Recurring Expenses section.
        const recurringBadge = e.recurringId ? `<span style="font-size: 0.7rem; color: var(--primary); background: rgba(var(--primary-rgb), 0.12); border-radius: 8px; padding: 2px 8px; margin-left: 6px; font-weight: 600; letter-spacing: 0.5px;"><i class="fa-solid fa-rotate" style="margin-right: 3px;"></i>Recurring</span>` : '';

        let dateHtml = '';
        if (e.createdAt) {
            try {
                const d = new Date(e.createdAt);
                dateHtml = `<span style="font-size: 0.73rem; color: var(--text-muted); margin-left: auto; white-space: nowrap;">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
            } catch (_) {}
        }

        return `
            <div class="card expense-card${archivedClass}" id="exp_${safeId}">
                <div class="expense-header">
                    <div style="flex:1; display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
                        <h3>${safeDesc}</h3>${archivedBadge}${recurringBadge}
                    </div>
                    ${dateHtml}
                    <div class="amount" style="margin-left: 1rem;">${symbol} ${e.amount.toFixed(2)}</div>
                    <div class="expense-actions">
                        ${actionButtons}
                    </div>
                </div>
                ${detailsHtml}
            </div>
        `;
    }

    // Render active expenses
    const sorted = [...activeExpenses].sort((a, b) => b.id.localeCompare(a.id));
    sorted.forEach(e => {
        list.innerHTML += buildExpenseCard(e, false);
    });

    // Render archived (Settled History) section
    if (archivedExpenses.length > 0) {
        const sortedArchived = [...archivedExpenses].sort((a, b) => b.id.localeCompare(a.id));
        const historyId = 'expense-history-body';

        // Sum up total for all currencies in archive for toggle label
        const archiveTotals = {};
        sortedArchived.forEach(e => {
            if (e.isSettlement) return;
            const cur = e.currency || 'USD';
            archiveTotals[cur] = (archiveTotals[cur] || 0) + (Number(e.amount) || 0);
        });
        const archiveTotalStr = Object.entries(archiveTotals)
            .map(([c, a]) => `${c} ${a.toFixed(2)}`).join(' + ');

        const historyHtml = `
            <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 0.5rem;">
                <button class="expense-history-toggle" id="expense-history-toggle" onclick="toggleExpenseHistory()" title="Toggle settled history">
                    <span><i class="fa-solid fa-box-archive" style="margin-right: 8px; color: var(--text-muted);"></i>Settled History <span style="font-weight: 400; opacity: 0.7;">(${sortedArchived.length}${archiveTotalStr ? ' · ' + archiveTotalStr : ''})</span></span>
                    <i class="fa-solid fa-chevron-down toggle-chevron"></i>
                </button>
                <div class="expense-history-body" id="${historyId}">
                    ${sortedArchived.map(e => buildExpenseCard(e, true)).join('')}
                </div>
            </div>
        `;
        list.innerHTML += historyHtml;
    }
}

window.toggleExpenseHistory = function() {
    const btn = document.getElementById('expense-history-toggle');
    const body = document.getElementById('expense-history-body');
    if (!btn || !body) return;
    const isOpen = body.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
};


function editExpenseUI(id) {
    const activeGroup = getActiveGroup();
    if (activeGroup.isLocked) {
        showAlert("Trip Locked", "This trip is locked. Expenses cannot be edited.", { icon: 'fa-lock' });
        return;
    }
    const expense = activeGroup.expenses.find(e => e.id === id);
    if (!expense) return;

    document.getElementById('expense-modal').classList.add('active');
    updateModalBodyClass();
    document.getElementById('expense-modal-title').textContent = 'Edit Expense';

    // Recurring setup only applies to brand new expenses, not edits
    const recurringGroup = document.getElementById('recurring-toggle-group');
    if (recurringGroup) recurringGroup.classList.add('hidden');
    const recurringCheckbox = document.getElementById('expense-recurring');
    if (recurringCheckbox) recurringCheckbox.checked = false;
    const recurringOptions = document.getElementById('recurring-options');
    if (recurringOptions) recurringOptions.classList.add('hidden');

    updatePayerDropdown();
    document.getElementById('expense-id').value = id;
    document.getElementById('expense-desc').value = expense.description;
    document.getElementById('expense-amount').value = expense.amount;
    document.getElementById('expense-currency').value = expense.currency || 'USD';

    if (expense.payers && expense.payers.length > 1) {
        togglePayerMode('multiple');
        expense.payers.forEach(p => {
            const input = document.getElementById('mp_' + p.personId);
            if (input) input.value = p.amount;
        });
        updateMultiplePayersSummary();
    } else {
        togglePayerMode('single');
        document.getElementById('expense-payer').value = expense.payers ? expense.payers[0].personId : (expense.payerId || expense.paidBy);
    }

    currentSplitMode = expense.splitType || expense.splitMode || 'equal';
    document.querySelectorAll('.split-mode-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-split') === currentSplitMode);
    });

    document.getElementById('split-participants').innerHTML = '';
    renderSplitParticipants();

    const splitContainer = document.getElementById('split-participants');
    splitContainer.querySelectorAll('.participant-cb').forEach(cb => cb.checked = false);
    splitContainer.querySelectorAll('.participant-card').forEach(card => card.classList.remove('active'));
    splitContainer.querySelectorAll('.participant-input').forEach(input => input.value = '');

    expense.participants.forEach(p => {
        const cb = splitContainer.querySelector(`[id="part_${p.personId}"]`);
        const card = splitContainer.querySelector(`[id="card_${p.personId}"]`);
        const input = splitContainer.querySelector(`[id="input_${p.personId}"]`);

        if (cb) cb.checked = true;
        if (card) card.classList.add('active');
        if (input) input.value = p.share;
    });

    if (currentSplitMode === 'paid_for' && expense.participants.length > 0) {
        const select = document.getElementById('paid-for-select');
        if (select) select.value = expense.participants[0].personId;
    }

    updateSplitSummary();
}

function deleteExpenseUI(id) {
    const activeGroup = getActiveGroup();
    if (activeGroup.isLocked) {
        showAlert("Trip Locked", "This trip is locked. Expenses cannot be deleted.", { icon: 'fa-lock' });
        return;
    }

    showConfirm('Delete Expense', 'Are you sure you want to delete this expense?', {
        danger: true,
        confirmText: 'Delete',
        icon: 'fa-trash-can'
    }).then((confirmed) => {
        if (confirmed) {
            deleteExpense(id).then(() => {
                const list = document.getElementById('expense-list');
                const item = document.getElementById(`exp_${id}`);
                if (item) item.remove();
                // Re-render all tabs so Balances and Settle Up reflect the deletion
                _renderAll();
            });
        }
    });
}

// Expenses UI Component

import { deleteExpense, addExpense, editExpense } from '../../api/expenses.js';
import { getActiveGroup, currentUser } from '../../state.js';
import { escapeHTML } from '../../utils/helpers.js';
import { showConfirm, showAlert } from '../../utils/dialogs.js';

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

    if (addExpenseBtn && expenseModal) {
        addExpenseBtn.addEventListener('click', () => {
            const activeGroup = getActiveGroup();
            if (!activeGroup || activeGroup.people.length === 0) {
                alert("Please add at least 2 people first.");
                return;
            }
            if (activeGroup.isLocked) {
                alert("This trip is locked. No new expenses can be added.");
                return;
            }

            resetExpenseForm();
            expenseModal.classList.add('active');
        });

        document.getElementById('save-expense-btn').addEventListener('click', async () => {
            const activeGroup = getActiveGroup();
            const desc = document.getElementById('expense-desc').value.trim();
            const amount = parseFloat(document.getElementById('expense-amount').value);
            const currency = document.getElementById('expense-currency')?.value || 'USD';
            const expenseIdInput = document.getElementById('expense-id');
            const existingId = expenseIdInput.value;

            if (!desc || isNaN(amount)) {
                alert('Please enter a valid description and amount.');
                return;
            }

            let payers = [];
            if (currentPayerMode === 'single') {
                const payerId = document.getElementById('expense-payer').value;
                if (!payerId) {
                    alert("Please select who paid.");
                    return;
                }
                payers.push({ personId: payerId, amount: amount });
            } else {
                const summaryEl = document.getElementById('multiple-payers-summary');
                if (summaryEl && summaryEl.classList.contains('error')) {
                    alert('The multiple payers total does not match the expense amount.');
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
                const splitContainer = document.getElementById('split-participants');
                const checkboxes = splitContainer ? splitContainer.querySelectorAll('.participant-cb:checked') : [];
                if (checkboxes.length === 0) {
                    alert('Please select at least one participant.');
                    return;
                }

                const summaryEl = document.getElementById('split-summary');
                if (summaryEl && summaryEl.classList.contains('error')) {
                    alert('The assigned splits do not add up to the total.');
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

            const expenseData = {
                id: existingId || 'e_' + Date.now(),
                description: desc,
                amount,
                currency,
                payerId: payers[0].personId, // fallback for legacy clients
                payers: payers,
                splitType: currentSplitMode,
                participants
            };

            const saveBtn = document.getElementById('save-expense-btn');
            saveBtn.disabled = true;
            try {
                if (existingId) {
                    await editExpense(existingId, expenseData);
                } else {
                    await addExpense(expenseData);
                }
                expenseModal.classList.remove('active');
            } catch (err) {
                alert("Error saving expense: " + err.message);
                console.error(err);
            } finally {
                saveBtn.disabled = false;
                renderAll();
            }
        });

        // Split tabs event listeners
        document.querySelectorAll('.split-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
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
    document.getElementById('split-participants').innerHTML = '';
    renderSplitParticipants();

    // Reset tabs
    document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.split-tab[data-split="equal"]').classList.add('active');
    currentSplitMode = 'equal';
    updateSplitSummary();
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
                <label>Who did you pay for?</label>
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

export function renderExpenses() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('expense-list');
    if (!list) return;

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

    const countDisplay = document.getElementById('expense-count-display');
    const expensesOnly = activeGroup.expenses.filter(e => !e.isSettlement && !e.id.startsWith('set_'));

    if (countDisplay) {
        const count = expensesOnly.length;
        countDisplay.textContent = count > 0 ? `(${count})` : '';
    }

    if (expensesOnly.length === 0) {
        list.innerHTML += '<p class="subtitle">No expenses added yet.</p>';
        return;
    }

    // Sort descending by ID (newest first)
    const sorted = [...expensesOnly].sort((a, b) => b.id.localeCompare(a.id));

    sorted.forEach(e => {
        let payerText = '';
        if (e.payers && e.payers.length > 1) {
            const payerNames = e.payers.map(p => {
                const person = activeGroup.people.find(person => person.id === p.personId);
                return person ? person.name : 'Unknown';
            });
            payerText = escapeHTML(payerNames.join(', '));
        } else {
            const rawPayerName = activeGroup.people.find(p => p.id === (e.payerId || e.paidBy))?.name || 'Unknown';
            payerText = escapeHTML(rawPayerName);
        }

        const symbol = escapeHTML(e.currency || 'USD');

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
        const safeSplit = escapeHTML(e.splitType || e.splitMode || 'equal');

        let actionButtons = '';
        if (!activeGroup.isLocked) {
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

        let detailsHtml = `
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

        list.innerHTML += `
            <div class="card expense-card" id="exp_${safeId}">
                <div class="expense-header">
                    <div style="flex:1">
                        <h3>${safeDesc}</h3>
                    </div>
                    <div class="amount">${symbol} ${e.amount.toFixed(2)}</div>
                    <div class="expense-actions">
                        ${actionButtons}
                    </div>
                </div>
                ${detailsHtml}
            </div>
        `;
    });
}

function editExpenseUI(id) {
    const activeGroup = getActiveGroup();
    if (activeGroup.isLocked) {
        showAlert("Trip Locked", "This trip is locked. Expenses cannot be edited.", { icon: 'fa-lock' });
        return;
    }
    const expense = activeGroup.expenses.find(e => e.id === id);
    if (!expense) return;

    document.getElementById('expense-modal').classList.add('active');
    document.getElementById('expense-modal-title').textContent = 'Edit Expense';

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
    document.querySelectorAll('.split-tab').forEach(t => {
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

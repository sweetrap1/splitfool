// State Management
let state = {
    activeGroupId: 'g_default',
    groups: [
        {
            id: 'g_default',
            name: 'Default Trip',
            people: [],
            expenses: []
        }
    ]
};

function getActiveGroup() {
    return state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initGroups();
    initNavigation();
    initModals();
    renderAll();
});

function renderAll() {
    renderGroupSelector();
    renderPeople();
    renderExpenses();
    renderBalances();
    renderSettleUp();
}

function saveState() {
    localStorage.setItem('splitfool_state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('splitfool_state');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);

            // Migration script for old flat structure
            if (parsed.people && Array.isArray(parsed.people)) {
                state = {
                    activeGroupId: 'g_default',
                    groups: [{
                        id: 'g_default',
                        name: 'My Trip',
                        people: parsed.people,
                        expenses: parsed.expenses || []
                    }]
                };
                saveState(); // Save migrated format
                return;
            }

            if (parsed.groups) {
                state = parsed;
            }
        } catch (e) {
            console.error('Failed to parse state from local storage');
        }
    }
}

// Global cached exchange rate so we don't spam the API
let cachedExchangeRate = null;
let isFetchingRate = false;

// Fetch live exchange rate from a public API (open.er-api.com is free, no auth)
async function fetchExchangeRate() {
    if (cachedExchangeRate || isFetchingRate) return;

    try {
        isFetchingRate = true;
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();

        if (data && data.rates && data.rates.MXN) {
            cachedExchangeRate = data.rates.MXN;

            // If the user hasn't actively typed in the box, update it
            const rateInputEl = document.getElementById('exchange-rate');
            if (rateInputEl && parseFloat(rateInputEl.value) === 17.00) {
                rateInputEl.value = cachedExchangeRate.toFixed(2);
                renderSettleUp(); // Re-render with the real rate
            }
        }
    } catch (e) {
        console.error("Failed to fetch live exchange rate", e);
    } finally {
        isFetchingRate = false;
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

        document.getElementById('save-group-btn').addEventListener('click', () => {
            const nameInput = document.getElementById('group-name').value.trim();
            if (nameInput) {
                const id = 'g_' + Date.now();
                state.groups.push({ id, name: nameInput, people: [], expenses: [] });
                state.activeGroupId = id;
                saveState();
                addGroupModal.classList.remove('active');
                renderAll();
            }
        });
    }
}

function renderGroupSelector() {
    const groupSelect = document.getElementById('active-group-select');
    if (!groupSelect) return;

    groupSelect.innerHTML = state.groups.map(g =>
        `<option value="${g.id}" ${g.id === state.activeGroupId ? 'selected' : ''}>${g.name}</option>`
    ).join('');
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
        personModal.classList.add('active');
    });

    // Add Expense Modal
    const expenseModal = document.getElementById('expense-modal');
    document.getElementById('add-expense-btn').addEventListener('click', () => {
        if (state.people.length < 2) {
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

    // Save Person handler stub
    document.getElementById('save-person-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('person-name');
        if (nameInput.value.trim() !== '') {
            addPerson(nameInput.value.trim());
            personModal.classList.remove('active');
        }
    });
}

// Data Operations
function addPerson(name) {
    const activeGroup = getActiveGroup();
    const id = 'p_' + Date.now();
    activeGroup.people.push({ id, name });
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
    list.innerHTML = '';

    if (activeGroup.people.length === 0) {
        list.innerHTML = '<p class="subtitle">No people added yet. Add some friends to get started!</p>';
        return;
    }

    activeGroup.people.forEach(p => {
        const char = p.name.charAt(0).toUpperCase();
        list.innerHTML += `
            <div class="card person-card">
                <div class="person-info">
                    <div class="avatar">${char}</div>
                    <h3>${p.name}</h3>
                </div>
                <button class="btn danger" onclick="removePerson('${p.id}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
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

    const expense = {
        id: 'e_' + Date.now(),
        description: desc,
        amount,
        currency,
        payerId,
        splitType: currentSplitMode,
        participants
    };

    const activeGroup = getActiveGroup();
    activeGroup.expenses.push(expense);
    saveState();
    document.getElementById('expense-modal').classList.remove('active');

    renderAll();
});

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
        const symbol = e.currency === 'USD' ? '<i class="fa-solid fa-dollar-sign"></i>' : '<i class="fa-solid fa-peso-sign"></i>';

        list.innerHTML += `
            <div class="card expense-card">
                <div class="expense-header">
                    <h3>${e.description}</h3>
                    <div class="amount">${symbol} ${e.amount.toFixed(2)}</div>
                </div>
                <div class="expense-details">
                    <span class="payer-badge">Paid by ${payer}</span>
                    <span class="split-info">${e.participants.length} people (${e.splitType})</span>
                </div>
            </div>
        `;
    });
}

function calculateBalances() {
    const activeGroup = getActiveGroup();
    const balances = {};

    // Initialize
    activeGroup.people.forEach(p => {
        balances[p.id] = { USD: 0, MXN: 0 };
    });

    // Calculate per expense
    activeGroup.expenses.forEach(e => {
        const amount = e.amount;
        const cur = e.currency;

        // Payer gets credit
        if (balances[e.payerId]) {
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

        const usdClass = b.USD > 0.01 ? 'positive' : b.USD < -0.01 ? 'negative' : '';
        const mxnClass = b.MXN > 0.01 ? 'positive' : b.MXN < -0.01 ? 'negative' : '';

        const usdText = b.USD > 0.01 ? `gets back $${b.USD.toFixed(2)}` : b.USD < -0.01 ? `owes $${Math.abs(b.USD).toFixed(2)}` : 'settled up';
        const mxnText = b.MXN > 0.01 ? `gets back $${b.MXN.toFixed(2)}` : b.MXN < -0.01 ? `owes $${Math.abs(b.MXN).toFixed(2)}` : 'settled up';

        list.innerHTML += `
            <div class="card person-card">
                <div class="person-info">
                    <div class="avatar">${p.name.charAt(0).toUpperCase()}</div>
                    <div>
                        <h3>${p.name}</h3>
                        <div style="font-size:0.9rem; color:var(--text-muted);">
                            USD: <span class="amount ${usdClass}">${usdText}</span><br>
                            MXN: <span class="amount ${mxnClass}">${mxnText}</span>
                        </div>
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
    if (!container) return; // fail safe

    container.innerHTML = '';

    if (activeGroup.people.length === 0) {
        container.innerHTML = '<div><p class="subtitle">No debts to settle.</p></div>';
        return;
    }

    // Initialize rate input fallback to 17 or cached rate
    const rateInputEl = document.getElementById('exchange-rate');
    if (rateInputEl && !rateInputEl.value) {
        rateInputEl.value = cachedExchangeRate ? cachedExchangeRate.toFixed(2) : 17.00;
    }

    const mode = document.getElementById('settle-mode').value;
    const rateInput = parseFloat(document.getElementById('exchange-rate').value);
    const exchangeRate = isNaN(rateInput) || rateInput <= 0 ? 17.00 : rateInput;

    const balances = calculateBalances();

    const renderTxList = (transactions, symbol) => {
        if (transactions.length === 0) {
            return '<div class="card" style="text-align:center; padding: 1rem;">All settled up! 🎉</div>';
        }

        let html = '<ul class="settle-list">';
        transactions.forEach(tx => {
            const fromName = activeGroup.people.find(p => p.id === tx.from)?.name || 'Unknown';
            const toName = activeGroup.people.find(p => p.id === tx.to)?.name || 'Unknown';

            html += `
                <li style="list-style:none;">
                    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <strong>${fromName}</strong> pays <strong>${toName}</strong>
                        </div>
                        <div class="amount positive">${symbol}${tx.amount.toFixed(2)}</div>
                    </div>
                </li>
            `;
        });
        html += '</ul>';
        return html;
    };

    if (mode === 'separate') {
        const usdTransactions = simplifyDebts(balances, 'USD');
        const mxnTransactions = simplifyDebts(balances, 'MXN');

        container.innerHTML = `
            <h3><i class="fa-solid fa-dollar-sign"></i> USD Settlements</h3>
            ${renderTxList(usdTransactions, '$')}
            
            <h3 style="margin-top: 2rem;"><i class="fa-solid fa-peso-sign"></i> MXN Settlements</h3>
            ${renderTxList(mxnTransactions, '$')}
        `;
    } else {
        // Combined mode
        const targetCurrency = mode; // 'USD' or 'MXN'
        const symbol = targetCurrency === 'USD' ? '$' : '$';

        // 1. Convert all balances to target currency first
        const combinedBalances = {};
        for (const [personId, personBals] of Object.entries(balances)) {
            let combinedAmount = 0;

            if (targetCurrency === 'USD') {
                // Keep USD as is, convert MXN to USD by dividing by rate
                combinedAmount = personBals.USD + (personBals.MXN / exchangeRate);
            } else {
                // Keep MXN as is, convert USD to MXN by multiplying by rate
                combinedAmount = personBals.MXN + (personBals.USD * exchangeRate);
            }

            // Just use the target currency key to reuse simplifyDebts
            combinedBalances[personId] = { [targetCurrency]: combinedAmount };
        }

        // 2. Simplify the combined balances
        const transactions = simplifyDebts(combinedBalances, targetCurrency);

        container.innerHTML = `
            <h3><i class="fa-solid ${targetCurrency === 'USD' ? 'fa-dollar-sign' : 'fa-peso-sign'}"></i> Combined ${targetCurrency} Settlements</h3>
            <p class="subtitle" style="margin-bottom: 1rem;">
                Exchange Rate Applied: 1 USD = ${exchangeRate.toFixed(2)} MXN 
                ${cachedExchangeRate && Math.abs(exchangeRate - cachedExchangeRate) < 0.01 ? '<span style="color:var(--success); font-size: 0.8em; margin-left: 0.5rem;"><i class="fa-solid fa-bolt"></i> Live API Rate</span>' : ''}
            </p>
            ${renderTxList(transactions, symbol)}
        `;
    }
}

// Call fetch on load
fetchExchangeRate();

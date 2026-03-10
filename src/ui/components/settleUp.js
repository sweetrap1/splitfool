// Settle Up UI component

import { calculateBalances, simplifyDebts, calculateDirectDebts } from '../../utils/math.js';
import { getActiveGroup, state, isGroupAdmin } from '../../state.js';
import { CURRENCY_NAMES, formatMoney, cachedExchangeRates, fetchExchangeRate, TOP_CURRENCIES } from '../../utils/currency.js';
import { escapeHTML } from '../../utils/helpers.js';
import { updateGroupLock, saveGroupState } from '../../api/groups.js';
import { showConfirm, showAlert } from '../../utils/dialogs.js';
import { archiveSettledExpenses } from '../../api/expenses.js';

// calculateDirectDebts is imported from ../../utils/math.js — single source of truth.

let settleCurrencyMode = 'USD';
let manualExchangeRate = null;
let shouldSimplify = localStorage.getItem('splitfool_simplify_debts') !== 'false';

/**
 * Call this whenever the active group is switched so the settle currency
 * mode resets to the new group's default instead of carrying over.
 */
export function resetSettleModeForGroup(group) {
    settleCurrencyMode = group?.settleCurrency || 'USD';
    manualExchangeRate = null;
    window._settleModeInitialized = true; // Prevent renderSettleUp from overwriting on first render
}

export function initSettleUpUI(renderAll) {
    const modeSelect = document.getElementById('settle-mode');
    const rateInput = document.getElementById('manual-rate');

    if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
            settleCurrencyMode = e.target.value;
            manualExchangeRate = null; // Reset manual override on change

            if (settleCurrencyMode !== 'separate') {
                const activeGroup = getActiveGroup();
                const balances = calculateBalances(activeGroup);

                // Allow re-initialization from group defaults on group switch
                window._settleModeInitialized = false;

                fetchExchangeRate(() => {
                    renderAll();
                });
            } else {
                renderAll();
            }
        });
    }

    const simplifyToggle = document.getElementById('simplify-debts-toggle');
    if (simplifyToggle) {
        simplifyToggle.checked = shouldSimplify;
        simplifyToggle.addEventListener('change', (e) => {
            shouldSimplify = e.target.checked;
            localStorage.setItem('splitfool_simplify_debts', shouldSimplify);
            renderAll();
        });
    }

    if (rateInput) {
        let _rateDebounce = null;
        rateInput.addEventListener('input', (e) => {
            manualExchangeRate = parseFloat(e.target.value) || null;
            clearTimeout(_rateDebounce);
            _rateDebounce = setTimeout(() => renderAll(), 300);
        });
        // Also update settleCurrencyMode on init if needed
        if (modeSelect) settleCurrencyMode = modeSelect.value;
    }

    window.toggleGroupLock = async (locked) => {
        const activeGroup = getActiveGroup();
        if (!activeGroup.id) return;

        try {
            await updateGroupLock(activeGroup.id, locked);
            // The subscription will update state, but we can force render immediately for better UX
            activeGroup.isLocked = locked;
            await saveGroupState(activeGroup); // Save the state change
            renderAll();
            if (locked) {
                showAlert('Trip Locked', 'This trip has been locked. You can now settle up.', { icon: 'fa-lock' });
            } else {
                showAlert('Trip Unlocked', 'This trip has been unlocked. Members can now add/edit expenses.', { icon: 'fa-unlock' });
            }
        } catch (e) {
            console.error("Failed to update group lock", e);
            showAlert("Error", "Failed to update group lock: " + e.message, { icon: 'fa-circle-exclamation' });
        }
    };

    window.sealAndArchive = async () => {
        const confirmed = await showConfirm(
            'Seal & Archive Expenses?',
            'This will archive all current expenses and settlements, resetting balances to zero. Your history will still be visible in the Settled History section on the Expenses tab.',
            { confirmText: 'Seal & Archive', icon: 'fa-box-archive' }
        );
        if (!confirmed) return;

        try {
            await archiveSettledExpenses();
            showAlert('All Sealed!', 'All expenses have been archived. Start fresh — your history is preserved in the Expenses tab.', { icon: 'fa-box-archive' });
            renderAll();
        } catch (err) {
            console.error('sealAndArchive failed', err);
            showAlert('Error', 'Failed to archive expenses: ' + err.message, { icon: 'fa-circle-exclamation' });
        }
    };

    window.unmarkSettle = async (settlementId) => {
        const activeGroup = getActiveGroup();
        const settlement = activeGroup.expenses.find(e => e.id === settlementId);
        if (!settlement) return;

        const confirmed = await showConfirm(
            'Remove Payment?',
            `Are you sure you want to remove this recorded payment of ${formatMoney(settlement.amount, settlement.currency)}?`,
            { danger: true, confirmText: 'Remove', icon: 'fa-trash-can' }
        );
        if (!confirmed) return;

        activeGroup.expenses = activeGroup.expenses.filter(e => e.id !== settlementId);
        await saveGroupState(activeGroup);
        renderAll();
    };
}

// Helper to determine which currency pair to override
function getManualRateConfig(targetCur, balances, activeGroup) {
    const usedCurrencies = new Set();
    if (balances) Object.values(balances).forEach(b => Object.keys(b).forEach(c => usedCurrencies.add(c)));
    if (activeGroup?.expenses) activeGroup.expenses.forEach(e => usedCurrencies.add(e.currency || 'USD'));

    let sourceCur = 'USD';
    if (targetCur === 'USD') {
        sourceCur = Array.from(usedCurrencies).find(c => c !== 'USD') || 'USD';
    } else {
        sourceCur = 'USD';
    }

    let liveRate = null;
    if (cachedExchangeRates) {
        if (sourceCur === 'USD') {
            liveRate = cachedExchangeRates[targetCur];
        } else if (targetCur === 'USD') {
            liveRate = 1 / (cachedExchangeRates[sourceCur] || 1);
        }
    }
    return { sourceCur, liveRate, usedCurrencies };
}

window.recordManualSettle = async (fromId, toId, amount, currency) => {
    const activeGroup = getActiveGroup();
    const debtor = activeGroup.people.find(p => p.id === fromId);
    const creditor = activeGroup.people.find(p => p.id === toId);

    const confirmed = await showConfirm(
        'Record Payment?',
        `Confirm that ${formatMoney(amount, currency)} has been paid from ${debtor?.name} to ${creditor?.name}.`,
        { confirmText: 'Mark Paid', icon: 'fa-check-circle' }
    );
    if (!confirmed) return;

    const settlement = {
        id: 'set_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        description: `Payment to ${creditor?.name}`,
        amount: amount,
        currency: currency,
        payerId: fromId,
        payers: [{ personId: fromId, amount: amount }],
        participants: [{ personId: toId, share: amount }],
        splitType: 'paid_for',
        isSettlement: true,
        createdAt: new Date().toISOString()
    };

    if (!activeGroup.expenses) activeGroup.expenses = [];
    activeGroup.expenses.push(settlement);
    await saveGroupState(activeGroup);
    renderAll();
};

function getName(id) {
    const activeGroup = getActiveGroup();
    const person = activeGroup.people.find(p => p.id === id);
    return person ? person.name : 'Unknown';
}

export function renderBalances() {
    const activeGroup = getActiveGroup();
    const list = document.getElementById('balances-list');
    if (!list) return;

    const titleEl = document.querySelector('#balances-tab h2');
    if (titleEl && !titleEl.innerHTML.includes('Net')) {
        titleEl.innerHTML = 'Personal Balances <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 400; text-transform: none; letter-spacing: 0;">(Net Total)</span>';
    }

    const balances = calculateBalances(activeGroup);
    const people = activeGroup.people || [];

    if (people.length === 0) {
        list.innerHTML = '<div class="empty-state">Add people to the group first.</div>';
        return;
    }

    window.toggleBalanceBreakdown = (personId) => {
        const breakdown = document.getElementById(`breakdown_${personId}`);
        const icon = document.getElementById(`icon_${personId}`);
        if (!breakdown) return;

        const isHidden = breakdown.classList.contains('hidden');
        if (isHidden) {
            breakdown.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            breakdown.classList.add('hidden');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    };

    list.innerHTML = people.map(p => {
        const char = p.name ? p.name.charAt(0).toUpperCase() : '?';
        const personBals = balances[p.id] || {};
        const currencies = Object.keys(personBals).filter(c => Math.abs(personBals[c]) > 0.01);

        let balanceHtml = '';
        if (currencies.length === 0) {
            balanceHtml = '<div class="amount zero">Settled up</div>';
        } else {
            balanceHtml = currencies.map(c => {
                const bal = personBals[c];
                const amountClass = bal > 0 ? 'positive' : 'negative';
                const prefix = bal > 0 ? '+' : '';
                return `<div class="amount ${amountClass}">${prefix}${formatMoney(bal, c)} <span style="font-size: 0.65rem; opacity: 0.7; font-weight: 500;">Net</span></div>`;
            }).join('');
        }

        const isMe = state.currentUser && p.userId === state.currentUser.uid;
        const meBadge = isMe ? `<span class="me-badge">Me</span>` : '';

        // Generate transactions breakdown
        const transactions = [];
        activeGroup.expenses.forEach(e => {
            const cur = e.currency || 'USD';
            const eAmount = Number(e.amount) || 0;
            const payer = e.payers?.find(pay => pay.personId === p.id);
            const legacyPayer = e.payerId === p.id || e.paidBy === p.id;
            const participant = e.participants?.find(part => part.personId === p.id);

            if (payer || (legacyPayer && !e.payers) || participant) {
                const paid = payer ? Number(payer.amount) : (legacyPayer && !e.payers ? eAmount : 0);

                // Convert participant.share to actual dollar amount based on split type
                let owed = 0;
                if (participant) {
                    const rawShare = Number(participant.share || participant.amount || participant.exactAmount) || 0;
                    if (e.splitType === 'percent') {
                        owed = (eAmount * rawShare) / 100;
                    } else if (e.splitType === 'shares') {
                        const totalShares = (e.participants || []).reduce((s, pt) => s + (Number(pt.share) || 0), 0);
                        owed = totalShares > 0 ? eAmount * (rawShare / totalShares) : 0;
                    } else {
                        // equal, exact, paid_for — share is already in dollars
                        owed = rawShare;
                    }
                }

                const net = paid - owed;

                if (Math.abs(net) > 0.005) {
                    transactions.push({
                        desc: e.description,
                        paid,
                        owed,
                        net,
                        currency: cur
                    });
                }
            }
        });

        const breakdownHtml = transactions.length > 0 ? `
            <div id="breakdown_${p.id}" class="balance-breakdown hidden" style="width: 100%; box-sizing: border-box; margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 1rem; font-weight: 800; opacity: 0.8;">Detailed History</div>
                <div class="balance-history-list" style="display: flex; flex-direction: column; gap: 4px;">
                    ${transactions.map(t => {
            const cls = t.net > 0 ? 'positive' : 'negative';
            const prefix = t.net > 0 ? '+' : '';
            return `
                            <div class="balance-history-row" style="display: grid; grid-template-columns: 1fr auto 100px; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.02); align-items: center; gap: 16px;">
                                <div style="color: var(--text-main); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(t.desc)}</div>
                                <div style="color: var(--text-muted); font-size: 0.8rem; text-align: right;">
                                    ${t.paid > 0 ? `Lent <span style="color: var(--success); font-weight: 600;">${formatMoney(t.paid, t.currency)}</span>` : `Owed <span style="color: var(--danger); font-weight: 600;">${formatMoney(t.owed, t.currency)}</span>`}
                                </div>
                                <div class="${cls}" style="font-weight: 800; text-align: right; font-size: 0.95rem;">${prefix}${formatMoney(t.net, t.currency)}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        ` : '';

        return `
            <div class="card person-card" style="margin-bottom: 1rem; cursor: pointer; padding: 1.25rem 1.5rem;" onclick="toggleBalanceBreakdown('${p.id}')">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 20px;">
                    <div class="person-info" style="flex: 1; min-width: 0;">
                        <div class="avatar" style="width: 44px; height: 44px; font-size: 1.1rem; flex-shrink: 0;">${char}</div>
                        <div style="min-width: 0; flex: 1;">
                            <div class="item-title" style="font-weight: 700; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(p.name)} ${meBadge}</div>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 20px; flex-shrink: 0;">
                        <div class="balances-container" style="text-align: right;">
                            ${balanceHtml}
                        </div>
                        <div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border-radius: 50%; border: 1px solid rgba(255,255,255,0.1);">
                            <i id="icon_${p.id}" class="fa-solid fa-chevron-down" style="color: var(--text-muted); font-size: 0.85rem; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);"></i>
                        </div>
                    </div>
                </div>
                ${breakdownHtml}
            </div>
        `;
    }).join('');
}

export function renderSettleUp() {
    const activeGroup = getActiveGroup();

    // Set default settle mode from group settings if not already explicitly changed in this session
    if (activeGroup.settleCurrency && !window._settleModeInitialized) {
        settleCurrencyMode = activeGroup.settleCurrency;
        window._settleModeInitialized = true;
    }

    const container = document.getElementById('settle-results-container');
    if (!container) return;

    const balances = calculateBalances(activeGroup);

    // Lock Notification for Admins
    let adminLockHtml = '';
    if (isGroupAdmin(activeGroup)) {
        if (activeGroup.isLocked) {
            adminLockHtml = `
                <button onclick="toggleGroupLock(false)" class="btn outline" style="margin-bottom: 0.75rem; width: 100%; border-color: var(--success); color: var(--success); font-weight: bold;">
                    <i class="fa-solid fa-unlock"></i> Unlock Group
                </button>
                <button onclick="sealAndArchive()" class="btn outline" style="margin-bottom: 1.5rem; width: 100%; border-color: rgba(99,102,241,0.6); color: var(--primary); font-weight: bold; background: rgba(99,102,241,0.06);">
                    <i class="fa-solid fa-box-archive"></i> Seal &amp; Archive All Expenses
                </button>
            `;
        } else {
            adminLockHtml = `<button onclick="toggleGroupLock(true)" class="btn outline" style="margin-bottom: 1.5rem; width: 100%; border-color: var(--warning); color: var(--warning); font-weight: bold;"><i class="fa-solid fa-lock"></i> Lock Group for Settlements</button>`;
        }
    }

    // Update Dropdown Options
    const modeSelect = document.getElementById('settle-mode');
    if (modeSelect) {
        const usedCurrencies = new Set();
        Object.values(balances).forEach(b => Object.keys(b).forEach(c => usedCurrencies.add(c)));

        // Combine used currencies and TOP_CURRENCIES to ensure user has options
        const allOptions = new Set(['separate', ...usedCurrencies, ...TOP_CURRENCIES]);

        let optionsHtml = '';
        allOptions.forEach(c => {
            if (c === 'separate') {
                optionsHtml += `<option value="separate" ${settleCurrencyMode === 'separate' ? 'selected' : ''}>Separate Currencies</option>`;
            } else {
                const label = CURRENCY_NAMES[c] ? `${c} - ${CURRENCY_NAMES[c]}` : c;
                optionsHtml += `<option value="${c}" ${settleCurrencyMode === c ? 'selected' : ''}>${label} Simplified</option>`;
            }
        });
        modeSelect.innerHTML = optionsHtml;
    }

    // Process transactions
    let finalBalances = balances;
    const targetCur = settleCurrencyMode;
    const { sourceCur, liveRate, usedCurrencies } = getManualRateConfig(targetCur, balances, activeGroup);

    const rateContainer = document.getElementById('manual-rate-container');

    if (targetCur === 'separate') {
        rateContainer?.classList.add('hidden');
    } else {
        rateContainer?.classList.remove('hidden');
        const srcLabelEl = document.getElementById('manual-rate-source');
        const tgtLabelEl = document.getElementById('manual-rate-target');
        if (srcLabelEl) srcLabelEl.textContent = sourceCur;
        if (tgtLabelEl) tgtLabelEl.textContent = targetCur;

        // Update live rate hint
        const hintEl = document.getElementById('live-rate-hint');
        if (hintEl) {
            if (liveRate && sourceCur !== targetCur) {
                hintEl.textContent = `Live Rate: 1 ${sourceCur} = ${liveRate.toFixed(4)} ${targetCur}`;
            } else {
                hintEl.textContent = '';
            }
        }

        const rateInput = document.getElementById('manual-rate');
        if (rateInput) {
            if (manualExchangeRate !== null) {
                rateInput.value = manualExchangeRate;
            } else {
                rateInput.value = ''; // Empty so it shows placeholder
            }
            if (liveRate) {
                rateInput.placeholder = liveRate.toFixed(4);
            } else {
                rateInput.placeholder = 'Enter rate';
            }
        }
    }

    // Calculate Group Totals Breakdown
    const breakdownContainer = document.getElementById('settlement-breakdown');
    const breakdownList = document.getElementById('breakdown-list');

    if (targetCur === 'separate' || !activeGroup.expenses || activeGroup.expenses.length === 0) {
        breakdownContainer?.classList.add('hidden');
    } else {
        breakdownContainer?.classList.remove('hidden');
        const groupTotals = {};
        activeGroup.expenses.forEach(e => {
            const cur = e.currency || 'USD';
            if (!groupTotals[cur]) groupTotals[cur] = 0;
            groupTotals[cur] += Number(e.amount) || 0;
        });

        let bHtml = '<table style="width:100%; border-collapse: collapse; font-size: 0.9rem;">';
        bHtml += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted);"><th style="text-align:left; padding: 0.5rem 0;">Currency</th><th style="text-align:right;">Subtotal</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Total (${targetCur})</th></tr>`;

        let grandTotal = 0;
        Object.keys(groupTotals).sort().forEach(cur => {
            const subtotal = groupTotals[cur];
            let curToTargetRate = 1;

            if (cur !== targetCur) {
                // If this is the specific pair we are overriding manually
                if (manualExchangeRate && cur === sourceCur) {
                    curToTargetRate = manualExchangeRate;
                } else if (cachedExchangeRates) {
                    // Standard USD-based conversion: (amt / rates[cur]) * rates[targetCur]
                    // If cur is USD, rates[cur] is 1.
                    const curInUsd = cur === 'USD' ? 1 : (1 / (cachedExchangeRates[cur] || 1));
                    const targetRate = targetCur === 'USD' ? 1 : (cachedExchangeRates[targetCur] || 1);
                    curToTargetRate = curInUsd * targetRate;
                }
            }

            const converted = subtotal * curToTargetRate;
            grandTotal += converted;

            bHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 0.75rem 0; font-weight: 500;">${cur}</td>
                    <td style="text-align:right;">${subtotal.toFixed(2)}</td>
                    <td style="text-align:right; color: var(--text-muted); font-size: 0.8rem;">${cur === targetCur ? '-' : curToTargetRate.toFixed(4)}</td>
                    <td style="text-align:right; font-weight: 600; color: var(--primary);">${converted.toFixed(2)}</td>
                </tr>
            `;
        });
        bHtml += `
            <tr>
                <td colspan="3" style="padding: 1rem 0 0.5rem; text-align:right; font-weight: bold; color: var(--text-muted);">Grand Total:</td>
                <td style="padding: 1rem 0 0.5rem; text-align:right; font-weight: 800; color: var(--primary); font-size: 1.1rem;">${grandTotal.toFixed(2)} ${targetCur}</td>
            </tr>
        `;
        bHtml += '</table>';
        if (breakdownList) breakdownList.innerHTML = bHtml;
    }

    let allTransactions = [];
    if (targetCur === 'separate') {
        // We still simplify per-currency in separate mode, which is less stable if payments are recorded,
        // but stable simplification across multiple currencies is much more complex.
        const curs = new Set();
        Object.values(balances).forEach(b => Object.keys(b).forEach(c => curs.add(c)));
        curs.forEach(c => {
            let txs = [];
            if (shouldSimplify) {
                txs = simplifyDebts(balances, c);
            } else {
                txs = calculateDirectDebts(activeGroup).filter(tx => tx.currency === c);
            }
            txs.forEach(t => allTransactions.push({ ...t, currency: c }));
        });
    } else {
        // STABLE SIMPLIFICATION:
        // 1. Calculate base balances (ignore settlements)
        const baseBalances = calculateBalances(activeGroup, true);
        const simplifiedBaseBalances = {};
        Object.keys(baseBalances).forEach(pId => {
            let total = 0;
            Object.keys(baseBalances[pId]).forEach(cur => {
                const amt = baseBalances[pId][cur];
                if (cur === targetCur) {
                    total += amt;
                } else {
                    let curToTargetRate = 1;
                    if (manualExchangeRate && cur === sourceCur) {
                        curToTargetRate = manualExchangeRate;
                    } else if (cachedExchangeRates) {
                        const curInUsd = cur === 'USD' ? 1 : (1 / (cachedExchangeRates[cur] || 1));
                        const targetRate = targetCur === 'USD' ? 1 : (cachedExchangeRates[targetCur] || 1);
                        curToTargetRate = curInUsd * targetRate;
                    }
                    total += amt * curToTargetRate;
                }
            });
            simplifiedBaseBalances[pId] = { [targetCur]: total };
        });

        // 2. Get the "Target Plan" from base balances
        if (shouldSimplify) {
            allTransactions = simplifyDebts(simplifiedBaseBalances, targetCur);
        } else {
            // For Direct mode, we use the native settlement handling in calculateDirectDebts
            // because it's more robust for pairwise connections.
            allTransactions = calculateDirectDebts(activeGroup, targetCur, cachedExchangeRates);
        }
        allTransactions.forEach(t => t.currency = targetCur);

        // 3. Subtract all existing settlements from this fixed plan (Simplified mode only)
        // Direct mode already handled them in the call above.
        if (shouldSimplify) {
            const settlements = (activeGroup.expenses || []).filter(e => e.isSettlement);
            settlements.forEach(s => {
                const sCur = s.currency || 'USD';
                let sAmountInTarget = Number(s.amount) || 0;

                if (sCur !== targetCur) {
                    let curToTargetRate = 1;
                    if (manualExchangeRate && sCur === sourceCur) {
                        curToTargetRate = manualExchangeRate;
                    } else if (cachedExchangeRates) {
                        const curInUsd = sCur === 'USD' ? 1 : (1 / (cachedExchangeRates[sCur] || 1));
                        const targetRate = targetCur === 'USD' ? 1 : (cachedExchangeRates[targetCur] || 1);
                        curToTargetRate = curInUsd * targetRate;
                    }
                    sAmountInTarget *= curToTargetRate;
                }

                // Find matching transaction (payer -> creditor)
                const debtorId = s.payerId || (s.payers && s.payers[0]?.personId);
                const creditorId = s.participants && s.participants[0]?.personId;

                if (debtorId && creditorId) {
                    // Check both directions — the simplified plan may have assigned the pair
                    // in either order depending on who came out net-positive.
                    let tx = allTransactions.find(t => t.from === debtorId && t.to === creditorId);
                    if (tx) {
                        tx.amount -= sAmountInTarget;
                    } else {
                        // Reversed: the debtor is actually the creditor in the simplified plan
                        tx = allTransactions.find(t => t.from === creditorId && t.to === debtorId);
                        if (tx) {
                            tx.amount -= sAmountInTarget;
                        }
                    }
                }
            });
        }

        // 4. Filter out settled items
        allTransactions = allTransactions.filter(t => t.amount > 0.005);
        finalBalances = simplifiedBaseBalances; // For UI consistency
    }

    let resultsHtml = '';

    if (state.currentUser && activeGroup.people) {
        const me = activeGroup.people.find(p => p.userId === state.currentUser.uid);
        if (me) {
            const myOwe = allTransactions.filter(t => t.from === me.id).reduce((sum, t) => sum + t.amount, 0);
            const myLent = allTransactions.filter(t => t.to === me.id).reduce((sum, t) => sum + t.amount, 0);

            // The absolute bottom line is the sum of what people owe you minus what you owe.
            const myNet = myLent - myOwe;

            resultsHtml += `
                <div class="card" style="margin-bottom: 2rem; background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); position: relative; overflow: hidden;">
                    <div style="position: absolute; right: -20px; top: -20px; font-size: 5rem; opacity: 0.03; transform: rotate(15deg); color: var(--primary); pointer-events: none;">
                        <i class="fa-solid fa-calculator"></i>
                    </div>
                    <h3 style="margin-bottom: 1.25rem;"><i class="fa-solid fa-user-check" style="color: var(--primary);"></i> Your Settlement Summary</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                        <div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; font-weight: 800;">Total You Owe</div>
                            <div style="font-size: 1.3rem; font-weight: 800; color: var(--danger);">${formatMoney(myOwe, targetCur)}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; font-weight: 800;">Total You Are Owed</div>
                            <div style="font-size: 1.3rem; font-weight: 800; color: var(--success);">${formatMoney(myLent, targetCur)}</div>
                        </div>
                    </div>
                    <div style="padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">Your Net Balance:</div>
                        <div style="font-size: 1.5rem; font-weight: 900; color: ${myNet >= 0.005 ? 'var(--success)' : (myNet < -0.005 ? 'var(--danger)' : 'var(--text-muted)')};">
                            ${myNet > 0.005 ? '+' : ''}${formatMoney(myNet, targetCur)}
                        </div>
                    </div>
                    <div style="margin-top: 1rem; font-size: 0.8rem; color: var(--text-muted); line-height: 1.4; background: rgba(0,0,0,0.2); padding: 0.75rem; border-radius: 8px;">
                        <i class="fa-solid fa-circle-info" style="color: var(--primary); margin-right: 4px;"></i>
                        ${shouldSimplify ?
                    `Debts are <b>simplified</b> to minimize payments. You only need to pay the net difference.` :
                    `Showing <b>direct debts</b> (traditional). You'll see everyone you owe directly for each expense.`}
                    </div>
                </div>
            `;
        }
    }


    // Group by creditor
    const byCreditor = {};
    const involvedInTransactions = new Set();

    allTransactions.forEach(t => {
        if (!byCreditor[t.to]) byCreditor[t.to] = [];
        byCreditor[t.to].push(t);
        involvedInTransactions.add(t.from);
        involvedInTransactions.add(t.to);
    });

    resultsHtml += Object.keys(byCreditor).map(creditorId => {
        const creditor = activeGroup.people.find(p => p.id === creditorId);
        const name = creditor?.name || 'Unknown';
        const txs = byCreditor[creditorId];
        const total = txs.reduce((sum, t) => sum + t.amount, 0);

        return `
            <div class="creditor-card card" style="margin-bottom: 1.5rem; padding: 0; overflow: hidden; border-left: 4px solid var(--primary);">
                <div class="creditor-header" style="background: rgba(255,255,255,0.03); padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-weight: 800; color: var(--text-main); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px;">
                        Pay to ${escapeHTML(name)}
                    </div>
                    <div style="font-weight: 800; color: var(--primary); font-size: 1.1rem;">
                        ${formatMoney(total, targetCur)}
                    </div>
                </div>
                <div class="debtor-list">
                    ${txs.map(t => {
            const debtor = activeGroup.people.find(p => p.id === t.from);
            const debtorName = debtor?.name || 'Unknown';
            const venmoUsername = creditor?.venmoUsername;
            const cleanVenmo = venmoUsername ? venmoUsername.replace('@', '') : null;
            const groupName = activeGroup.name || 'Trip';
            const venmoLink = cleanVenmo ? `https://venmo.com/?tx=pay&txn=pay&audience=private&recipients=${cleanVenmo}&amount=${t.amount.toFixed(2)}&note=${encodeURIComponent(groupName + ' Settlement')}` : null;

            const isDebtorMe = state.currentUser && debtor?.userId === state.currentUser.uid;

            return `
                            <div class="debtor-row" style="padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03);">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div class="avatar" style="width: 32px; height: 32px; font-size: 0.8rem; background: var(--bg-hover);">${debtorName.charAt(0).toUpperCase()}</div>
                                    <div>
                                        <div style="font-weight: 600; font-size: 0.9rem;">${escapeHTML(debtorName)}</div>
                                        <div style="font-size: 0.8rem; color: var(--text-muted);">
                                            owes ${formatMoney(t.amount, t.currency)}
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    ${isDebtorMe ? `
                                        ${venmoLink ? `
                                            <a href="${venmoLink}" target="_blank" class="btn sm" style="text-decoration: none; background: #3d95ce; color: white; display: inline-flex; align-items: center; gap: 4px; font-weight: bold;">
                                                Pay
                                            </a>` : `
                                            <span class="btn sm disabled" style="background: var(--bg-hover); opacity: 0.5; color: var(--text-muted); cursor: not-allowed; display: inline-flex; align-items: center; gap: 4px; font-weight: bold;" title="Creditor has no Venmo set">
                                                Pay
                                            </span>`
                    }` : ''
                }
                                    <button onclick="recordManualSettle('${t.from}', '${t.to}', ${t.amount}, '${t.currency}')" class="btn outline sm">
                                        Mark Paid
                                    </button>
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }).join('');

    // Render Settled Up cards for everyone else
    const settledPeople = activeGroup.people.filter(p => !involvedInTransactions.has(p.id));
    if (settledPeople.length > 0) {
        resultsHtml += `
            <div class="settled-group" style="margin-top: 2rem;">
                <h4 style="margin-bottom: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">
                    Already Settled
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
                    ${settledPeople.map(p => `
                        <div class="card" style="padding: 1rem; background: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.2); border-style: dashed; display: flex; align-items: center; gap: 12px;">
                            <div class="avatar" style="width: 32px; height: 32px; font-size: 0.8rem; background: var(--success); opacity: 0.8;">${p.name.charAt(0).toUpperCase()}</div>
                            <div>
                                <div style="font-weight: 600; font-size: 0.9rem;">${escapeHTML(p.name)}</div>
                                <div style="color: var(--success); font-size: 0.75rem; font-weight: bold;">Settled Up</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    if (allTransactions.length === 0 && settledPeople.length === activeGroup.people.length) {
        resultsHtml = `
            <div class="settled-up-msg" style="text-align: center; color: var(--success); padding: 2rem;">
                 <i class="fa-solid fa-check-circle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                 <h3>Everyone is all settled up!</h3>
            </div>
        ` + resultsHtml;
    }

    const settlements = (activeGroup.expenses || []).filter(e => e.isSettlement);
    let settlementsHtml = '';
    if (settlements.length > 0) {
        settlementsHtml = `
            <div class="settlements-history" style="margin-top: 2rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 1.5rem;">
                <h4 style="margin-bottom: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">Recent Settlements</h4>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${settlements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(s => `
                        <div class="card" style="padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
                            <div>
                                <div style="font-weight: 600; font-size: 0.9rem;">${escapeHTML(s.description)}</div>
                                <div style="font-size: 0.8rem; color: var(--text-muted);">${formatMoney(s.amount, s.currency)} • ${new Date(s.createdAt).toLocaleDateString()}</div>
                            </div>
                            <button onclick="unmarkSettle('${s.id}')" class="btn sm outline danger" style="padding: 4px 12px; font-size: 0.75rem;">
                                Unmark
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = adminLockHtml + resultsHtml + settlementsHtml;
    renderMemberBreakdown(activeGroup, balances, targetCur, manualExchangeRate, liveRate, sourceCur);
}

function renderMemberBreakdown(activeGroup, balances, targetCur, manualExchangeRate, liveRate, sourceCur) {
    const section = document.getElementById('member-breakdown-section');
    const list = document.getElementById('member-breakdown-list');
    if (!section || !list) return;

    if (!activeGroup.expenses || activeGroup.expenses.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    const sortedPeople = [...activeGroup.people].sort((a, b) => a.name.localeCompare(b.name));

    list.innerHTML = `
        <div class="card" style="padding: 0; overflow-x: auto;">
            <table class="breakdown-table" style="width:100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead style="background: rgba(255,255,255,0.05);">
                    <tr>
                        <th style="padding: 12px; text-align: left;">Member</th>
                        <th style="padding: 12px; text-align: left;">Paid</th>
                        <th style="padding: 12px; text-align: left;">Owed</th>
                        <th style="padding: 12px; text-align: left;">Net</th>
                        ${targetCur !== 'separate' ? `<th style="padding: 12px; text-align: left;">Net (${targetCur})</th>` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${sortedPeople.map(p => {
        const pBals = balances[p.id] || {};
        const curs = Object.keys(pBals);

        let balDisplay = '-';
        if (curs.length > 0) {
            balDisplay = curs.map(c => {
                const b = pBals[c];
                const cls = b > 0 ? 'positive' : (b < 0 ? 'negative' : '');
                return `<div class="${cls}">${formatMoney(b, c)}</div>`;
            }).join('');
        }

        const totals = { paid: {}, owed: {} };
        activeGroup.expenses.forEach(e => {
            const cur = e.currency || 'USD';
            if (!totals.paid[cur]) totals.paid[cur] = 0;
            if (!totals.owed[cur]) totals.owed[cur] = 0;

            if (e.payers) {
                const me = e.payers.find(pay => pay.personId === p.id);
                if (me) totals.paid[cur] += Number(me.amount) || 0;
            } else if (e.payerId === p.id || e.paidBy === p.id) {
                totals.paid[cur] += Number(e.amount) || 0;
            }

            const participant = (e.participants || e.paidFor)?.find(part => part.personId === p.id);
            if (participant) {
                const eAmt = Number(e.amount) || 0;
                const rawShare = Number(participant.share || participant.amount || participant.exactAmount) || 0;
                let owedAmt = rawShare;
                if (e.splitType === 'percent') {
                    owedAmt = (eAmt * rawShare) / 100;
                } else if (e.splitType === 'shares') {
                    const totalShares = (e.participants || []).reduce((s, pt) => s + (Number(pt.share) || 0), 0);
                    owedAmt = totalShares > 0 ? eAmt * (rawShare / totalShares) : 0;
                }
                totals.owed[cur] += owedAmt;
            }
        });

        const paidHtml = Object.keys(totals.paid).filter(c => totals.paid[c] > 0).map(c => formatMoney(totals.paid[c], c));
        const owedHtml = Object.keys(totals.owed).filter(c => totals.owed[c] > 0).map(c => formatMoney(totals.owed[c], c));

        let simplifiedNetHtml = '';
        if (targetCur !== 'separate') {
            let total = 0;
            const rate = manualExchangeRate || liveRate || 1;
            Object.keys(pBals).forEach(cur => {
                const amt = pBals[cur];
                if (cur === targetCur) {
                    total += amt;
                } else {
                    let curToTargetRate = 1;
                    if (manualExchangeRate && cur === sourceCur) {
                        curToTargetRate = manualExchangeRate;
                    } else if (cachedExchangeRates) {
                        const curInUsd = cur === 'USD' ? 1 : (1 / (cachedExchangeRates[cur] || 1));
                        const targetRate = targetCur === 'USD' ? 1 : (cachedExchangeRates[targetCur] || 1);
                        curToTargetRate = curInUsd * targetRate;
                    }
                    total += amt * curToTargetRate;
                }
            });
            const cls = total > 0.01 ? 'positive' : (total < -0.01 ? 'negative' : '');
            simplifiedNetHtml = `<td style="padding: 12px; font-weight: bold;" class="${cls}">${total.toFixed(2)}</td>`;
        }

        return `
                            <tr style="border-top: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 12px; font-weight: 500;">${escapeHTML(p.name)}</td>
                                <td style="padding: 12px;">${paidHtml.join('<br>') || '0'}</td>
                                <td style="padding: 12px;">${owedHtml.join('<br>') || '0'}</td>
                                <td style="padding: 12px;">${balDisplay}</td>
                                ${simplifiedNetHtml}
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

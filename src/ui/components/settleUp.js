// Settle Up UI component

import { calculateBalances, simplifyDebts } from '../../utils/math.js';
import { getActiveGroup, currentUser, isGroupAdmin } from '../../state.js';
import { CURRENCY_NAMES, formatMoney, cachedExchangeRates, fetchExchangeRate, TOP_CURRENCIES } from '../../utils/currency.js';
import { escapeHTML } from '../../utils/helpers.js';
import { updateGroupLock, saveGroupState } from '../../api/groups.js';

let settleCurrencyMode = 'USD'; // Default to USD
let manualExchangeRate = null;

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

                fetchExchangeRate(() => {
                    renderAll();
                });
            } else {
                renderAll();
            }
        });
    }

    if (rateInput) {
        rateInput.addEventListener('input', (e) => {
            manualExchangeRate = parseFloat(e.target.value) || null;
            renderAll();
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
            renderAll();
        } catch (e) {
            console.error("Failed to update group lock", e);
            alert("Failed to update group lock: " + e.message);
        }
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

    if (!confirm(`Record a payment of ${formatMoney(amount, currency)} from ${debtor?.name} to ${creditor?.name}?`)) return;

    const settlement = {
        id: 'set_' + Date.now(),
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

    const balances = calculateBalances(activeGroup);
    const people = activeGroup.people || [];

    if (people.length === 0) {
        list.innerHTML = '<div class="empty-state">Add people to the group first.</div>';
        return;
    }

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
                return `<div class="amount ${amountClass}">${prefix}${formatMoney(bal, c)}</div>`;
            }).join('');
        }

        const isMe = currentUser && p.userId === currentUser.uid;
        const meBadge = isMe ? `<span class="me-badge">Me</span>` : '';

        return `
            <div class="card person-card" style="margin-bottom: 1rem;">
                <div class="person-info">
                    <div class="avatar">${char}</div>
                    <div>
                        <div class="item-title" style="font-weight: 600;">${escapeHTML(p.name)} ${meBadge}</div>
                        <div class="item-subtitle" style="font-size: 0.85rem; color: var(--text-muted);">${currencies.length > 0 ? 'Current Balance' : 'No outstanding debts'}</div>
                    </div>
                </div>
                <div class="balances-container" style="text-align: right;">
                    ${balanceHtml}
                </div>
            </div>
        `;
    }).join('');
}

export function renderSettleUp() {
    const activeGroup = getActiveGroup();
    const container = document.getElementById('settle-results-container');
    if (!container) return;

    const balances = calculateBalances(activeGroup);

    // Lock Notification for Admins
    let adminLockHtml = '';
    if (isGroupAdmin(activeGroup)) {
        if (activeGroup.isLocked) {
            adminLockHtml = `<button onclick="toggleGroupLock(false)" class="btn outline" style="margin-bottom: 1.5rem; width: 100%; border-color: var(--success); color: var(--success); font-weight: bold;"><i class="fa-solid fa-unlock"></i> Unlock Group</button>`;
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
        const curs = new Set();
        Object.values(balances).forEach(b => Object.keys(b).forEach(c => curs.add(c)));
        curs.forEach(c => {
            const txs = simplifyDebts(balances, c);
            txs.forEach(t => allTransactions.push({ ...t, currency: c }));
        });
    } else {
        const simplifiedBalances = {};
        Object.keys(balances).forEach(pId => {
            let total = 0;
            Object.keys(balances[pId]).forEach(cur => {
                const amt = balances[pId][cur];
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
            simplifiedBalances[pId] = { [targetCur]: total };
        });
        finalBalances = simplifiedBalances;
        allTransactions = simplifyDebts(finalBalances, targetCur);
        allTransactions.forEach(t => t.currency = targetCur);
    }

    let resultsHtml = '';

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
            const venmoLink = cleanVenmo ? `https://venmo.com/?tx=pay&txn=pay&audience=private&recipients=${cleanVenmo}&amount=${t.amount.toFixed(2)}&note=Trip%20Settlement` : null;

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
                                    ${venmoLink ? `
                                        <a href="${venmoLink}" target="_blank" class="btn sm" style="background: #3d95ce; color: white; display: inline-flex; align-items: center; gap: 4px; font-weight: bold;">
                                            Pay/Venmo
                                        </a>` : ''
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

    container.innerHTML = adminLockHtml + resultsHtml;
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
                totals.owed[cur] += Number(participant.share || participant.amount || participant.exactAmount) || 0;
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

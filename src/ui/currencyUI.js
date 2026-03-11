import { CURRENCY_NAMES } from '../utils/currency.js';
import { escapeHTML } from '../utils/helpers.js';

/**
 * Dynamically populates all currency-related <select> elements in the app.
 * This ensures consistency and makes it easy to add new currencies.
 */
export function populateAllCurrencyDropdowns() {
    const currencyEntries = Object.entries(CURRENCY_NAMES).sort((a, b) => a[0].localeCompare(b[0]));
    
    // 1. Standard Expense Currencies (Plain labels)
    const standardSelects = [
        'expense-currency',
        'group-default-currency',
        'edit-group-default-currency'
    ];
    
    // 2. Settlement Selection (Includes "Simplified" label and "Separate" option)
    const settleSelects = [
        'group-settle-currency',
        'edit-group-settle-currency'
    ];

    const standardOptionsHtml = currencyEntries.map(([code, name]) => 
        `<option value="${escapeHTML(code)}" ${code === 'USD' ? 'selected' : ''}>${escapeHTML(code)} - ${escapeHTML(name)}</option>`
    ).join('');

    const settleOptionsHtml = currencyEntries.map(([code, name]) => 
        `<option value="${escapeHTML(code)}" ${code === 'USD' ? 'selected' : ''}>${escapeHTML(code)} - Simplified</option>`
    ).join('') + `<option value="separate">Separate Currencies</option>`;

    standardSelects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = standardOptionsHtml;
    });

    settleSelects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = settleOptionsHtml;
    });
}

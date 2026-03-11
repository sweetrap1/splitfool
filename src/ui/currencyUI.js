import { CURRENCY_NAMES, getDetectedCurrency } from '../utils/currency.js';
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

    const defaultCurrency = getDetectedCurrency();

    const standardOptionsHtml = currencyEntries.map(([code, name]) => 
        `<option value="${escapeHTML(code)}" ${code === defaultCurrency ? 'selected' : ''}>${escapeHTML(code)} - ${escapeHTML(name)}</option>`
    ).join('');

    const settleOptionsHtml = currencyEntries.map(([code, name]) => 
        `<option value="${escapeHTML(code)}" ${code === defaultCurrency ? 'selected' : ''}>${escapeHTML(code)} - Simplified</option>`
    ).join('') + `<option value="separate">Separate Currencies</option>`;

    const setValues = () => {
        standardSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = standardOptionsHtml;
                // Force selection
                el.value = defaultCurrency;
                const opt = el.querySelector(`option[value="${defaultCurrency}"]`);
                if (opt) opt.setAttribute('selected', 'selected');
            }
        });

        settleSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = settleOptionsHtml;
                // Force selection
                el.value = defaultCurrency;
                const opt = el.querySelector(`option[value="${defaultCurrency}"]`);
                if (opt) opt.setAttribute('selected', 'selected');
            }
        });
    };

    setValues();
    // Second pass to ensure DOM catch-up / script overrides
    setTimeout(setValues, 50);
}

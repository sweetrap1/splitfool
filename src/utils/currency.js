// Currency Utilities

export const CURRENCY_NAMES = {
    "USD": "US Dollar", "MXN": "Mexican Peso", "EUR": "Euro", "GBP": "British Pound",
    "CAD": "Canadian Dollar", "AUD": "Australian Dollar", "JPY": "Japanese Yen",
    "INR": "Indian Rupee", "CNY": "Chinese Yuan", "BRL": "Brazilian Real",
    "SGD": "Singapore Dollar", "ZAR": "South African Rand", "NZD": "New Zealand Dollar",
    "CHF": "Swiss Franc", "HKD": "Hong Kong Dollar", "KRW": "South Korean Won",
    "SEK": "Swedish Krona", "NOK": "Norwegian Krone", "DKK": "Danish Krone",
    "RUB": "Russian Ruble", "TRY": "Turkish Lira", "AED": "UAE Dirham",
    "COP": "Colombian Peso", "ARS": "Argentine Peso", "CLP": "Chilean Peso",
    "PEN": "Peruvian Sol", "PHP": "Philippine Peso", "IDR": "Indonesian Rupiah",
    "MYR": "Malaysian Ringgit", "THB": "Thai Baht", "VND": "Vietnamese Dong",
    "HUF": "Hungarian Forint", "CZK": "Czech Koruna", "PLN": "Polish Zloty",
    "ILS": "Israeli New Shekel", "TWD": "New Taiwan Dollar", "SAR": "Saudi Riyal",
    "KWD": "Kuwaiti Dinar", "EGP": "Egyptian Pound"
};

export const TOP_CURRENCIES = [
    "USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD",
    "SEK", "KRW", "SGD", "NOK", "MXN", "INR", "RUB", "ZAR", "TRY", "BRL",
    "TWD", "DKK", "PLN", "THB", "IDR"
];

export function getCurrencyLabel(code) {
    if (CURRENCY_NAMES[code]) return `${code} - ${CURRENCY_NAMES[code]}`;

    try {
        const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
        const name = displayNames.of(code);
        if (name && name !== code) return `${code} - ${name}`;
    } catch (e) { }

    return code;
}

export let cachedExchangeRates = null;
export let isFetchingRate = false;

// Format money consistently based on currency
export function formatMoney(amount, currencyCode = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

export async function fetchExchangeRate(onSuccess) {
    if (cachedExchangeRates || isFetchingRate) return;

    try {
        isFetchingRate = true;
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();

        if (data && data.rates) {
            cachedExchangeRates = data.rates;
            if (onSuccess) onSuccess();
        }
    } catch (e) {
        console.error("Failed to fetch live exchange rate", e);
    } finally {
        isFetchingRate = false;
    }
}

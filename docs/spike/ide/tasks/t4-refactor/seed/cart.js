// The shopping cart: line items, a subtotal, the tax and a printable summary.

function computeTax(amountCents, ratePercent) {
    // Round half up to the cent.
    return Math.floor((amountCents * ratePercent) / 100 + 0.5);
}

function formatMoney(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const euros = Math.floor(abs / 100);
    const rest = String(abs % 100).padStart(2, '0');
    return `${sign}${euros.toLocaleString('en-US')}.${rest} EUR`;
}

function subtotal(items) {
    return items.reduce((sum, it) => sum + it.priceCents * it.qty, 0);
}

function summary(items, ratePercent) {
    const sub = subtotal(items);
    const tax = computeTax(sub, ratePercent);
    return [
        ...items.map((it) => `${it.qty} x ${it.name}: ${formatMoney(it.priceCents * it.qty)}`),
        `Subtotal: ${formatMoney(sub)}`,
        `Tax (${ratePercent}%): ${formatMoney(tax)}`,
        `Total: ${formatMoney(sub + tax)}`,
    ].join('\n');
}

module.exports = { subtotal, summary };

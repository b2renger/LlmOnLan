// Invoices: one line per order, with the tax of each order.

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

function invoiceLines(orders, ratePercent) {
    return orders.map((o) => {
        const tax = computeTax(o.amountCents, ratePercent);
        return `#${o.id} ${o.customer}: ${formatMoney(o.amountCents)} + tax ${formatMoney(tax)} = ${formatMoney(o.amountCents + tax)}`;
    });
}

function grandTotal(orders, ratePercent) {
    return formatMoney(orders.reduce((sum, o) => sum + o.amountCents + computeTax(o.amountCents, ratePercent), 0));
}

module.exports = { invoiceLines, grandTotal };

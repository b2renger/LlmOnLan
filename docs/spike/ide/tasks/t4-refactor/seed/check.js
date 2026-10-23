// Run with: node check.js
const assert = require('node:assert/strict');
const { subtotal, summary } = require('./cart');
const { invoiceLines, grandTotal } = require('./invoice');

const items = [{ name: 'Pen', priceCents: 199, qty: 3 }, { name: 'Notebook', priceCents: 1250, qty: 1 }];
assert.equal(subtotal(items), 1847);
assert.equal(summary(items, 20), '3 x Pen: 5.97 EUR\n1 x Notebook: 12.50 EUR\nSubtotal: 18.47 EUR\nTax (20%): 3.69 EUR\nTotal: 22.16 EUR');
const orders = [{ id: 1, customer: 'Ada', amountCents: 123456 }, { id: 2, customer: 'Bob', amountCents: -500 }];
assert.deepEqual(invoiceLines(orders, 5.5), ['#1 Ada: 1,234.56 EUR + tax 67.90 EUR = 1,302.46 EUR', '#2 Bob: -5.00 EUR + tax -0.27 EUR = -5.27 EUR']);
assert.equal(grandTotal(orders, 5.5), '1,297.19 EUR');
console.log('all checks pass');

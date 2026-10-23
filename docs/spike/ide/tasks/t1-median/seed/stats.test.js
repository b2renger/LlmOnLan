// Run with: node stats.test.js
const assert = require('node:assert/strict');
const { mean, median, range } = require('./stats');

assert.equal(mean([1, 2, 3, 4]), 2.5);
assert.ok(Number.isNaN(mean([])));
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([10, 9, 2]), 9);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(median([40, 100, 1, 5, 25, 10]), 17.5);
assert.ok(Number.isNaN(median([])));
assert.equal(range([5, -2, 11]), 13);
console.log('all stats tests pass');

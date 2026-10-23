// Run with: node wordfreq.test.js
const assert = require('node:assert/strict');
const { countWords, topWords } = require('./wordfreq');

// countWords(text) → { word: count }: words are lower-cased runs of letters (any alphabet, accents included),
// an apostrophe inside a word belongs to it, digits and punctuation separate words.
assert.deepEqual(countWords('The cat and the hat.'), { the: 2, cat: 1, and: 1, hat: 1 });
assert.deepEqual(countWords(''), {});
assert.deepEqual(countWords("Don't stop -- don't!"), { "don't": 2, stop: 1 });
assert.deepEqual(countWords('Café, café; CAFÉ'), { 'café': 3 });
assert.deepEqual(countWords('route66 is 2 fast'), { route: 1, is: 1, fast: 1 });
assert.deepEqual(countWords("'quoted' words"), { quoted: 1, words: 1 });

// topWords(text, n) → the n most frequent [word, count] pairs, most frequent first, ties in alphabetical order.
assert.deepEqual(topWords('b a c b a b', 2), [['b', 3], ['a', 2]]);
assert.deepEqual(topWords('pear apple pear apple fig', 3), [['apple', 2], ['pear', 2], ['fig', 1]]);
assert.deepEqual(topWords('one two', 5), [['one', 1], ['two', 1]]);
assert.deepEqual(topWords('a a b', 0), []);
console.log('all wordfreq tests pass');

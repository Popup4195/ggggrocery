// confirmedNameMatch: a product picked from the dropdown (confirmedName) must be matchable
// even when the loose typed word ("cabb") is only part of a word in the product name
const test = require('node:test');
const assert = require('node:assert');

const { mergeConfirmedCandidates, pickBestMatch } = require('../services/productNameMatch');

const FULL = 'fresh vegetable cabbage green half';
const CAT = 'Fruit & Vegetables';

const DOCS = [
    { productName: FULL, chainId: 'countdown', unitPrice: 3.45, price: 3.45, category: CAT },
    { productName: 'fresh vegetable cabbage whole', chainId: 'countdown', unitPrice: 5, price: 5, category: CAT },
    { productName: 'cabbage green', chainId: 'newworld', unitPrice: 4.99, price: 4.99, category: CAT },
    { productName: 'pork & cabbage dumplings', chainId: 'paknsave', unitPrice: 1.46, price: 1.46, category: 'Frozen' }
];

test('(a) name="cabb" + confirmedName finds the exact product', () => {
    const candidates = mergeConfirmedCandidates(DOCS, 'cabb', 'countdown', FULL);
    assert.deepStrictEqual(candidates.map(d => d.productName), [FULL]);
    const best = pickBestMatch(candidates, 'cabb', CAT, FULL);
    assert.strictEqual(best.productName, FULL);
    assert.strictEqual(best.unitPrice, 3.45);
});

test('(b) name="cabb" without confirmedName still has no candidates', () => {
    for (const chainId of ['countdown', 'newworld', 'paknsave']) {
        assert.deepStrictEqual(mergeConfirmedCandidates(DOCS, 'cabb', chainId, null), []);
        assert.deepStrictEqual(mergeConfirmedCandidates(DOCS, 'cabb', chainId, undefined), []);
        assert.deepStrictEqual(mergeConfirmedCandidates(DOCS, 'cabb', chainId, ''), []);
    }
});

test('(c) a chain without the confirmed product falls back to loose matching', () => {
    const candidates = mergeConfirmedCandidates(DOCS, 'cabbage', 'newworld', FULL);
    assert.deepStrictEqual(candidates.map(d => d.productName), ['cabbage green']);
    assert.strictEqual(pickBestMatch(candidates, 'cabbage', CAT, FULL).productName, 'cabbage green');
});

test('(c) without confirmedName the result equals the plain loose candidates', () => {
    const withMerge = mergeConfirmedCandidates(DOCS, 'cabbage', 'countdown', null);
    assert.deepStrictEqual(withMerge.map(d => d.productName), [FULL, 'fresh vegetable cabbage whole']);
});

test('(c) confirmed product already in the loose candidates is not duplicated', () => {
    const candidates = mergeConfirmedCandidates(DOCS, 'cabbage', 'countdown', FULL);
    assert.deepStrictEqual(candidates.map(d => d.productName), [FULL, 'fresh vegetable cabbage whole']);
});

test('(d) case and surrounding spaces in confirmedName do not matter', () => {
    const candidates = mergeConfirmedCandidates(DOCS, 'cabb', 'countdown', '  Fresh Vegetable CABBAGE Green Half  ');
    assert.deepStrictEqual(candidates.map(d => d.productName), [FULL]);
    const best = pickBestMatch(candidates, 'cabb', CAT, '  Fresh Vegetable CABBAGE Green Half  ');
    assert.strictEqual(best.productName, FULL);
});

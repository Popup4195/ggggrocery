// planRanking: plans missing fewer items rank first, and only complete single-store
// plans may seed the branch-and-bound upper bound
const test = require('node:test');
const assert = require('node:assert');

const { countMissing, comparePlans, initialUpperBound } = require('../services/planRanking');

const plan = (name, cost, missingItems = [], globallyUnavailableItems = [], coveredCount = 0) => ({
    name,
    trueCost: cost,
    groceryTotal: cost,
    missingItems,
    globallyUnavailableItems,
    breakdown: Array.from({ length: coveredCount }, (_, i) => ({ name: `item${i}` }))
});

test('a plan missing fewer items ranks before a cheaper plan missing more', () => {
    const plans = [
        plan('newworld only', 9.32, ['cabbage', 'sparkling water']),
        plan('countdown only', 23.11, ['milk']),
        plan('newworld + countdown', 30.5, [])
    ];
    plans.sort(comparePlans('trueCost'));
    assert.deepStrictEqual(plans.map(p => p.name), ['newworld + countdown', 'countdown only', 'newworld only']);
});

test('plans with the same missing count are ordered by cost (driving and walking keys)', () => {
    const a = plan('a', 12, ['x']);
    const b = plan('b', 8, ['y']);
    assert.deepStrictEqual([a, b].sort(comparePlans('trueCost')).map(p => p.name), ['b', 'a']);
    assert.deepStrictEqual([a, b].sort(comparePlans('groceryTotal')).map(p => p.name), ['b', 'a']);
});

test('items unavailable at every store do not count as missing', () => {
    // single-store plans list globally unavailable items in missingItems, split plans do not
    const single = plan('single', 5, ['saffron'], ['saffron']);
    const split = plan('split', 7, [], ['saffron']);
    assert.strictEqual(countMissing(single), 0);
    assert.deepStrictEqual([split, single].sort(comparePlans('trueCost')).map(p => p.name), ['single', 'split']);
});

test('when nothing is missing, ordering is by cost only (unchanged behaviour)', () => {
    const plans = [plan('c', 10.67), plan('a', 7.41), plan('b', 8.89)];
    plans.sort(comparePlans('trueCost'));
    assert.deepStrictEqual(plans.map(p => p.name), ['a', 'b', 'c']);
});

test('upper bound ignores single-store plans that miss items', () => {
    const singles = [
        plan('newworld', 9.32, ['cabbage', 'sparkling water'], [], 1),
        plan('countdown', 23.11, ['milk'], [], 2)
    ];
    assert.strictEqual(initialUpperBound(singles, 3), Infinity);
});

test('upper bound is the cheapest complete single-store plan', () => {
    const singles = [
        plan('partial cheap', 4.3, ['milk'], [], 1),
        plan('complete', 12.5, [], [], 2),
        plan('complete dearer', 15, [], [], 2)
    ];
    assert.strictEqual(initialUpperBound(singles, 2), 12.5);
});

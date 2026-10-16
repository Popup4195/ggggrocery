// branchSelection: manual branch selection (max 7 across all chains)
const test = require('node:test');
const assert = require('node:assert');

const {
    MAX_SELECTED_BRANCHES,
    validateBranchIds,
    filterBranchesBySelection
} = require('../services/branchSelection');

const ids = n => Array.from({ length: n }, (_, i) => `branch_${i + 1}`);

const BRANCHES = [
    { branchId: 'paknsave_kilbirnie', chainId: 'paknsave' },
    { branchId: 'paknsave_petone', chainId: 'paknsave' },
    { branchId: 'newworld_thorndon', chainId: 'newworld' }
];

test('limit is 7 branches', () => {
    assert.strictEqual(MAX_SELECTED_BRANCHES, 7);
});

test('7 branches are valid', () => {
    assert.strictEqual(validateBranchIds(ids(7)), null);
});

test('8 branches are rejected', () => {
    const err = validateBranchIds(ids(8));
    assert.ok(typeof err === 'string' && err.includes('7'), err);
});

test('duplicate branchIds are rejected', () => {
    const err = validateBranchIds(['paknsave_petone', 'paknsave_petone']);
    assert.ok(typeof err === 'string' && /duplicate/i.test(err), err);
});

test('non-array and non-string elements are rejected', () => {
    assert.ok(validateBranchIds('paknsave_petone'));
    assert.ok(validateBranchIds(null));
    assert.ok(validateBranchIds({ 0: 'paknsave_petone' }));
    assert.ok(validateBranchIds(['paknsave_petone', 42]));
    assert.ok(validateBranchIds(['']));
});

test('empty array is valid', () => {
    assert.strictEqual(validateBranchIds([]), null);
});

test('empty or missing selection keeps every branch (default behaviour)', () => {
    assert.strictEqual(filterBranchesBySelection(BRANCHES, []), BRANCHES);
    assert.strictEqual(filterBranchesBySelection(BRANCHES, undefined), BRANCHES);
    assert.strictEqual(filterBranchesBySelection(BRANCHES, null), BRANCHES);
});

test('selection keeps only the ticked branches', () => {
    const result = filterBranchesBySelection(BRANCHES, ['paknsave_petone', 'newworld_thorndon']);
    assert.deepStrictEqual(result.map(b => b.branchId), ['paknsave_petone', 'newworld_thorndon']);
});

test('selection with no branch of a chain leaves that chain empty', () => {
    const paknsaveOnly = BRANCHES.filter(b => b.chainId === 'paknsave');
    assert.deepStrictEqual(filterBranchesBySelection(paknsaveOnly, ['newworld_thorndon']), []);
});

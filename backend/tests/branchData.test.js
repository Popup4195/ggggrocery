// branchData: sanity checks on the real Wellington branch list used by scripts/updateBranches.js
const test = require('node:test');
const assert = require('node:assert');

const branches = require('../scripts/data/wellington_branches_clean.json');

test('data file has exactly 36 branches', () => {
    assert.strictEqual(branches.length, 36);
});

test('branchId is present and unique', () => {
    const ids = branches.map(b => b.branchId);
    ids.forEach(id => assert.ok(typeof id === 'string' && id.length > 0));
    assert.strictEqual(new Set(ids).size, ids.length);
});

test('chainId is one of paknsave/newworld/countdown', () => {
    const allowed = ['paknsave', 'newworld', 'countdown'];
    branches.forEach(b => assert.ok(allowed.includes(b.chainId), `${b.branchId}: ${b.chainId}`));
});

test('coordinates are inside the Wellington region', () => {
    branches.forEach(b => {
        assert.ok(typeof b.lat === 'number' && b.lat >= -41.5 && b.lat <= -40.8, `${b.branchId} lat ${b.lat}`);
        assert.ok(typeof b.lng === 'number' && b.lng >= 174.5 && b.lng <= 175.2, `${b.branchId} lng ${b.lng}`);
    });
});

test('name is a non-empty string', () => {
    branches.forEach(b => assert.ok(typeof b.name === 'string' && b.name.trim().length > 0, b.branchId));
});

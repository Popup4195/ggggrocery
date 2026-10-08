// routeCache: the same store set should only trigger one route calculation per request
const test = require('node:test');
const assert = require('node:assert');

// stub the distance function before planService loads it
const distanceService = require('../services/distanceService');
let distanceCalls = 0;
distanceService.getDistances = async (lat, lng, destinations) => {
    distanceCalls++;
    return destinations.map(d => ({ branchId: d.branchId, distanceKm: 1 }));
};

const { getRouteWithCache } = require('../services/planService');

const A = { branchId: 'a1', latitude: -41.28, longitude: 174.77 };
const B = { branchId: 'b1', latitude: -41.29, longitude: 174.78 };
const C = { branchId: 'c1', latitude: -41.30, longitude: 174.79 };

test('same store set only calls the distance function once', async () => {
    const routeCache = new Map();
    distanceCalls = 0;

    const first = await getRouteWithCache(routeCache, ['paknsave', 'newworld'], -41.2865, 174.7762, [A, B]);
    const callsAfterFirst = distanceCalls;
    assert.ok(callsAfterFirst > 0);

    // same set, different insertion order → served from cache
    const second = await getRouteWithCache(routeCache, ['newworld', 'paknsave'], -41.2865, 174.7762, [B, A]);
    assert.strictEqual(distanceCalls, callsAfterFirst);
    assert.deepStrictEqual(second, first);

    // a different store set is calculated again
    await getRouteWithCache(routeCache, ['paknsave', 'newworld', 'countdown'], -41.2865, 174.7762, [A, B, C]);
    assert.ok(distanceCalls > callsAfterFirst);
    assert.strictEqual(routeCache.size, 2);
});

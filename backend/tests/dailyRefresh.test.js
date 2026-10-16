// dailyRefresh exit code: offline, scraping/DB are stubbed by helpers/dailyRefreshStubs.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const backendDir = path.resolve(__dirname, '..');

function runDailyRefresh(scenario) {
    return spawnSync(
        process.execPath,
        ['-r', path.join(__dirname, 'helpers', 'dailyRefreshStubs.js'), path.join('scripts', 'scraper', 'dailyRefresh.js')],
        { cwd: backendDir, env: { ...process.env, STUB_SCENARIO: scenario }, encoding: 'utf8', timeout: 30000 }
    );
}

test('a chain with 0 products exits with code 1 and reports the HTTP statuses', () => {
    const r = runDailyRefresh('paknsave:0:403,403,403;newworld:5:200,200');
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /\[paknsave\] ERROR: 0 products scraped, the site may be rejecting requests/);
    assert.match(r.stdout, /\[paknsave\] HTTP status codes: 403 x3/);
    assert.match(r.stdout, /\[newworld\] HTTP status codes: 200 x2/);
    assert.match(r.stdout, /Summary: paknsave: 0 products \[403 x3\] \| newworld: 5 products \[200 x2\]/);
    assert.match(r.stderr, /Daily refresh has failed chains: paknsave; setting exit code to 1/);
    // the whole log should be English (no CJK characters)
    assert.doesNotMatch(r.stdout + r.stderr, /[　-〿一-鿿＀-￯]/);
});

test('all chains with products exits with code 0', () => {
    const r = runDailyRefresh('paknsave:3:200;newworld:5:200,200');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /0 products scraped/);
    assert.doesNotMatch(r.stderr, /failed chains/);
});

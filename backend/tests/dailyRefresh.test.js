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
    assert.match(r.stderr, /\[paknsave\] 错误: 抓到 0 个商品，可能被网站拒绝/);
    assert.match(r.stdout, /\[paknsave\] HTTP 状态码: 403 x3/);
    assert.match(r.stdout, /\[newworld\] HTTP 状态码: 200 x2/);
    assert.match(r.stdout, /汇总: paknsave: 0 个商品 \[403 x3\] \| newworld: 5 个商品 \[200 x2\]/);
});

test('all chains with products exits with code 0', () => {
    const r = runDailyRefresh('paknsave:3:200;newworld:5:200,200');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /抓到 0 个商品/);
});

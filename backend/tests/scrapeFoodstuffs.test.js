// Pak'nSave / New World 价格解析（离线，不联网）
// fixtures/foodstuffs/*.html 是从浏览器保存的真实 Pak'nSave 品类页里截取的商品卡片
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const {
    parseCategoryHtml,
    parseUnitPriceText,
    checkUnitPriceConsistency,
    extractShelfPriceFromText
} = require('../scripts/scraper/scrapeFoodstuffs');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'foodstuffs', name), 'utf8');

function parseOne(html) {
    const products = parseCategoryHtml(html, 'paknsave');
    assert.strictEqual(products.length, 1);
    return products[0];
}

test('Pams Edam Cheese 500g: shelf price split into dollars/cents, unit price $1.60/100g', () => {
    const p = parseOne(fixture('pams-edam-cheese-500g.html'));
    assert.strictEqual(p.productId, '5007356');
    assert.strictEqual(p.name, 'Pams Edam Cheese');
    assert.strictEqual(p.packSize, '500g');
    assert.strictEqual(p.price, 7.99);
    assert.strictEqual(p.unitPrice, 1.6);
    assert.strictEqual(p.baseUnit, '100g');
    assert.strictEqual(p.suspect, false);
});

test('Pams Edam Cheese 1kg: price 12.79, unit price $1.28/100g', () => {
    const p = parseOne(fixture('pams-edam-cheese-1kg.html'));
    assert.strictEqual(p.packSize, '1kg');
    assert.strictEqual(p.price, 12.79);
    assert.strictEqual(p.unitPrice, 1.28);
    assert.strictEqual(p.baseUnit, '100g');
    assert.strictEqual(p.suspect, false);
});

test('Anchor Blue Milk 2l: price 5.59, unit price $2.80/1L', () => {
    const p = parseOne(fixture('anchor-blue-milk-2l.html'));
    assert.strictEqual(p.packSize, '2l');
    assert.strictEqual(p.price, 5.59);
    assert.strictEqual(p.unitPrice, 2.8);
    assert.strictEqual(p.baseUnit, '1L');
    assert.strictEqual(p.suspect, false);
});

test('no unit price (CONSTRUCTED: real 500g edam card with the unit price element removed)', () => {
    const $ = cheerio.load(fixture('pams-edam-cheese-500g.html'));
    $('[data-testid="non-promo-unit-price"]').remove();
    const p = parseOne($.html());
    assert.strictEqual(p.price, 7.99);
    assert.strictEqual(p.unitPrice, null);
    assert.strictEqual(p.baseUnit, null);
    assert.strictEqual(p.suspect, false);
});

test('unit price text allows spaces around the slash', () => {
    assert.deepStrictEqual(parseUnitPriceText('$1.60 / 100g'), { unitPrice: 1.6, baseUnit: '100g' });
    assert.deepStrictEqual(parseUnitPriceText('$3.79/kg'), { unitPrice: 3.79, baseUnit: '1kg' });
});

test('text fallback skips the unit price and pack size', () => {
    assert.strictEqual(extractShelfPriceFromText('Pams Edam Cheese 500g 7 99 ea $1.60/100g'), 7.99);
});

test('consistency check flags a unit price more than 5% off', () => {
    // 旧数据里的情况：price 被抓成了每 100g 价 1.66
    const r = checkUnitPriceConsistency({ price: 1.66, pricePer: 'ea', packSize: '500g', unitPrice: 1.66, baseUnit: '100g' });
    assert.strictEqual(r.suspect, true);
});

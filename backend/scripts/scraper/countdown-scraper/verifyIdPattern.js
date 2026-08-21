/**
 * 验证：Woolworths 每个商品的标题/价格/换算单价，是不是真的能通过
 * product-{stockcode}-title / product-{stockcode}-price / product-{stockcode}-unitPrice
 * 这种规律的 ID 直接查到。
 *
 * 用法：
 *   node verifyIdPattern.js
 */
const { chromium } = require('playwright');

async function main() {
  console.log('启动浏览器...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await browser.newPage();
  const url = 'https://www.woolworths.co.nz/shop/browse/fruit-veg/fruit';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('a[href*="/shop/productdetails"]', { timeout: 15000 });

  const stockcode = '133211'; // 就是 Bananas 那个，我们已经确认过的商品编号

  const fieldsToCheck = ['title', 'price', 'unitPrice', 'save', 'promoInfo'];

  console.log(`\n验证 stockcode=${stockcode} 这个商品的各个字段:\n`);

  for (const field of fieldsToCheck) {
    const selector = `#product-${stockcode}-${field}`;
    const locator = page.locator(selector);
    const count = await locator.count();

    if (count === 0) {
      console.log(`❌ ${selector} → 找不到这个元素`);
      continue;
    }

    const text = await locator.first().innerText().catch(() => '(无法读取文字，可能是图片等非文字元素)');
    console.log(`✅ ${selector} → "${text.trim()}"`);
  }

  // 顺手看一下商品图片的 alt 文字是不是真的是干净的商品名
  const imgAlt = await page
    .locator(`a[href*="stockcode=${stockcode}"] img`)
    .first()
    .getAttribute('alt');
  console.log(`\n图片 alt 文字: "${imgAlt}"`);

  await browser.close();
}

main().catch((err) => {
  console.error('失败:', err.message);
});

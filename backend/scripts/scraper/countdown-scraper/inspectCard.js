/**
 * 诊断脚本：把 Woolworths 商品卡片的真实 HTML 结构打印到终端。
 * 不需要你自己去开发者工具里找，Playwright 直接帮你读出来。
 *
 * 用法：
 *   node inspectCard.js
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
  console.log(`打开页面: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('a[href*="/shop/productdetails"]', { timeout: 15000 });

  // 找到第一个商品链接，往上爬几层，把每一层的 HTML 都打印出来，
  // 方便我们对着看，判断哪一层刚好包住一整张商品卡片（不多不少）
  const firstLink = page.locator('a[href*="/shop/productdetails"]').first();

  console.log('\n========== 商品链接本身 ==========');
  console.log(await firstLink.evaluate((el) => el.outerHTML));

  let current = firstLink;
  for (let level = 1; level <= 5; level++) {
    current = current.locator('xpath=..'); // 往上爬一层父级
    const html = await current.evaluate((el) => el.outerHTML);
    console.log(`\n========== 往上第 ${level} 层 ==========`);
    // 只打印前 800 个字符，太长的话终端会刷屏刷不完
    console.log(html.length > 800 ? html.slice(0, 800) + '\n...(后面省略)' : html);
  }

  console.log('\n\n把上面这几段（尤其是"往上第1层"到"往上第3层"）复制发给我就行。');

  await browser.close();
}

main().catch((err) => {
  console.error('失败:', err.message);
});

/**
 * 最小验证脚本：只确认 Playwright 能不能正常打开 Woolworths(原Countdown)的页面、
 * 等到商品加载出来，不做任何数据抓取，先把"能不能看到"这件事确认清楚。
 *
 * 用法：
 *   node testPlaywright.js
 */
const { chromium } = require('playwright');

async function main() {
  console.log('启动浏览器...');
  const browser = await chromium.launch({
    channel: 'chrome', // 不用 Playwright 自带的精简版 Chromium，直接调用电脑上装的真实 Chrome 本体
    headless: false, // 这次用可见窗口模式，会真的弹出一个 Chrome 窗口，不是后台隐身跑
    args: [
      '--disable-blink-features=AutomationControlled', // 隐藏"这是自动化程序"这个最基础的标记位
    ],
  });

  const page = await browser.newPage();

  // ===== 第一步：先测试一个简单的、没有任何反爬虫机制的网站 =====
  // 用来排查"是 Playwright/网络环境本身有问题"还是"只有 Woolworths 拦截"
  console.log('\n【基础测试】先打开一个简单网站，确认 Playwright 本身工作正常...');
  try {
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    console.log(`✅ 基础测试通过！能正常打开普通网站，页面标题: "${title}"`);
  } catch (err) {
    console.error(`❌ 基础测试失败: ${err.message}`);
    console.error('\n这说明问题不在 Woolworths，是这台电脑的网络环境本身有问题');
    console.error('（比如防毒软件拦截、公司/学校网络代理、防火墙设置等），需要先排查这个。');
    await browser.close();
    return;
  }

  // ===== 第二步：再测试 Woolworths =====
  console.log('\n【正式测试】基础测试通过，现在测试 Woolworths...');
  const url = 'https://www.woolworths.co.nz/shop/browse/fruit-veg/fruit';
  console.log(`打开页面: ${url}`);

  try {
    // 换成 domcontentloaded（页面骨架加载完就算数），
    // 不再用 networkidle（网络完全空闲）——SPA 页面有时候会一直有后台请求，
    // 导致 networkidle 永远等不到，误判成失败
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 再额外等一下商品卡片这个元素真的出现在页面上
    await page.waitForSelector('a[href*="/shop/productdetails"]', { timeout: 15000 });

    const productLinks = await page.locator('a[href*="/shop/productdetails"]').count();
    console.log(`\n✅ 成功！页面上找到 ${productLinks} 个商品链接`);

    if (productLinks > 0) {
      const firstHref = await page.locator('a[href*="/shop/productdetails"]').first().getAttribute('href');
      console.log(`第一个商品链接示例: ${firstHref}`);
    }
  } catch (err) {
    console.error(`\n❌ Woolworths 测试失败: ${err.message}`);
    console.error('基础测试通过但这个失败了，说明问题确实出在 Woolworths 这边（可能在拦截自动化浏览器）');
  } finally {
    await browser.close();
  }
}

main();

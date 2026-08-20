/**
 * Woolworths (原 Countdown) 商品价格抓取脚本
 *
 * 跟 Pak'nSave/New World 那套 cheerio 方案完全不同的技术路线：
 * Woolworths 是纯前端渲染的 SPA，必须用 Playwright 真的跑一个浏览器才能看到数据。
 *
 * 关键发现：每个商品的标题/价格/换算单价，都有规律的 ID：
 *   #product-{stockcode}-title
 *   #product-{stockcode}-price
 *   #product-{stockcode}-unitPrice
 * 直接按 ID 查，比"往上爬猜边界"精确得多，不会有串数据的问题。
 *
 * ⚠️ 必须用真实 Chrome + 可见窗口模式才能绕过它的反爬虫检测，
 * 这意味着只能在本地手动跑，没法部署到服务器自动跑。
 *
 * 用法：
 *   node scrapeWoolworths.js "<分类URL>"
 *   node scrapeWoolworths.js "<分类URL>" --all
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://www.woolworths.co.nz';

function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPage(url, pageNum) {
  const u = new URL(url);
  u.searchParams.set('page', String(pageNum));
  return u.toString();
}

/**
 * 把 "$\n3\n75\nkg" 这种被拆成几行的价格文字，解析成 { price: 3.75, unit: 'kg' }
 */
function parsePriceText(raw) {
  if (!raw) return { price: null, unit: null };
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/\$?\s*(\d+)\s+(\d{2})\s*([a-zA-Z]*)/);
  if (!match) return { price: null, unit: null };
  return { price: parseFloat(`${match[1]}.${match[2]}`), unit: match[3] || null };
}

/**
 * 把 "$3.75 / 1kg" 这种换算单价文字，解析成 { unitPrice: 3.75, baseUnit: '1kg' }
 */
function parseUnitPriceText(raw) {
  if (!raw) return { unitPrice: null, baseUnit: null };
  const match = raw.match(/\$?(\d+\.\d+)\s*\/\s*(.+)/);
  if (!match) return { unitPrice: null, baseUnit: null };
  return { unitPrice: parseFloat(match[1]), baseUnit: match[2].trim() };
}

/**
 * 抓一个分类页（已经打开的 page 对象，跳转到指定网址）
 */
async function scrapeCategoryPage(page, categoryUrl, categoryLabel = null) {
  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForSelector('a[href*="/shop/productdetails"]', { timeout: 10000 });
  } catch {
    return []; // 这一页没有商品，大概率翻到头了
  }

  const links = await page.locator('a[href*="/shop/productdetails"]').all();
  const products = [];
  const seen = new Set();

  for (const link of links) {
    const href = await link.getAttribute('href');
    if (!href) continue;

    const match = href.match(/stockcode=(\d+)/);
    if (!match) continue;
    const stockcode = match[1];

    if (seen.has(stockcode)) continue; // 同一个商品在页面上可能重复出现（比如推荐区块）
    seen.add(stockcode);

    // 按我们验证过的 ID 规律，直接精确查每个字段，不用"猜边界"
    const titleLocator = page.locator(`#product-${stockcode}-title`);
    const priceLocator = page.locator(`#product-${stockcode}-price`);
    const unitPriceLocator = page.locator(`#product-${stockcode}-unitPrice`);

    const name =
      (await titleLocator.count()) > 0 ? (await titleLocator.first().innerText()).trim() : null;
    const priceRaw =
      (await priceLocator.count()) > 0 ? await priceLocator.first().innerText() : null;
    const unitPriceRaw =
      (await unitPriceLocator.count()) > 0 ? await unitPriceLocator.first().innerText() : null;

    const { price, unit } = parsePriceText(priceRaw);
    const { unitPrice, baseUnit } = parseUnitPriceText(unitPriceRaw);

    // 图片：src 里通常带商品编号（比如 /images/2010/133211.jpg），
    // 校验一下编号对不对得上，跟 Foodstuffs 那边一样的保险机制
    const imgSrc = await link.locator('img').first().getAttribute('src').catch(() => null);
    const imageUrl = imgSrc && imgSrc.includes(stockcode) ? imgSrc : null;

    if (stockcode && price !== null) {
      products.push({
        productId: stockcode,
        unit,
        name,
        price,
        unitPrice,
        baseUnit,
        category: categoryLabel,
        imageUrl,
        sourceUrl: BASE_URL + href,
        chain: 'countdown',
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  return products;
}

/**
 * 抓一个分类的所有分页
 */
async function scrapeAllPages(page, baseCategoryUrl, categoryLabel = null, maxPages = 20) {
  const all = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = withPage(baseCategoryUrl, pageNum);
    const products = await scrapeCategoryPage(page, url, categoryLabel);
    if (products.length === 0) {
      console.log(`第 ${pageNum} 页没有商品了，翻页结束`);
      break;
    }
    console.log(`第 ${pageNum} 页抓到 ${products.length} 个商品`);
    all.push(...products);
    if (pageNum < maxPages) {
      await randomDelay(3000, 7000);
    }
  }
  return all;
}

// 命令行直接跑
if (require.main === module) {
  const [, , categoryUrl, flag] = process.argv;
  if (!categoryUrl) {
    console.error('用法: node scrapeWoolworths.js "<分类URL>" [--all]');
    process.exit(1);
  }

  (async () => {
    console.log('启动浏览器（会弹出真实 Chrome 窗口，属于正常现象）...');
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage();

    try {
      const products =
        flag === '--all'
          ? await scrapeAllPages(page, categoryUrl)
          : await scrapeCategoryPage(page, categoryUrl);

      console.log(`\n共抓到 ${products.length} 个商品\n`);
      console.log(JSON.stringify(products.slice(0, 5), null, 2));
      console.log(products.length > 5 ? `\n...还有 ${products.length - 5} 个，已省略` : '');
    } catch (err) {
      console.error('抓取失败:', err.message);
    } finally {
      await browser.close();
    }
  })();
}

module.exports = { scrapeCategoryPage, scrapeAllPages, parsePriceText, parseUnitPriceText };

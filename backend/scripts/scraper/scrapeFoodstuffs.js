/**
 * New World / Pak'nSave 商品价格抓取脚本
 *
 * 两家都是 Foodstuffs 旗下，网站结构几乎一样，所以共用一份逻辑，
 * 只是换个域名 + 门店参数。
 *
 * 用法：
 *   node scrapeFoodstuffs.js newworld  <分类URL>
 *   node scrapeFoodstuffs.js paknsave  <分类URL>
 *
 * 例如：
 *   node scrapeFoodstuffs.js paknsave "https://www.paknsave.co.nz/shop/category/fruit-and-vegetables/fruit?pg=1"
 */

const axios = require('axios');
const cheerio = require('cheerio');

/**
 * 随机等待一段时间（在 minMs ~ maxMs 之间随机取值），而不是固定死一个数字。
 * 固定不变的间隔本身就是一个很容易被识别成"这是脚本不是人"的特征，
 * 随机波动更接近真人翻页的节奏。
 */
function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHAINS = {
  newworld: {
    baseUrl: 'https://www.newworld.co.nz',
    storeCodeSuffix: '000nw', // 从产品 URL 里观察到的门店后缀，例如 5028110_ea_000nw
  },
  paknsave: {
    baseUrl: 'https://www.paknsave.co.nz',
    storeCodeSuffix: '000pns',
  },
};

/**
 * 从商品链接往上爬，一层层找，直到找到"看起来包含价格"的祖先节点为止。
 *
 * 关键改进：每爬一层都检查这一层里有没有出现"不止一个商品链接"——
 * 如果出现了，说明已经爬到了"同时包住好几个商品"的共享容器，
 * 上一层的数据才是干净的（只属于当前这一个商品），不能再往上爬了。
 * 这样能避免把邻居商品的价格/图片误当成自己的。
 */
function findCardWithPrice($el, $, maxDepth = 8) {
  let $node = $el.parent();
  let $lastCleanNode = $el.parent(); // 上一层还"干净"（只含1个商品链接）的节点，作为兜底
  for (let i = 0; i < maxDepth; i++) {
    if ($node.length === 0) break;

    const linksInsideCount = $node.find('a[href*="/shop/product/"]').length;
    if (linksInsideCount > 1) {
      // 这一层已经跨到别的商品了，退回上一层干净的节点
      return $lastCleanNode;
    }

    if (extractShelfPriceFromText(spacedText($node, $)) !== null) {
      return $node;
    }

    $lastCleanNode = $node;
    $node = $node.parent();
  }
  return $lastCleanNode;
}
/**
 * 商品链接自带一个 ?name=royal-gala-apples 这样的参数，几乎不会缺失。
 * 当链接本身的可见文字抓不到商品名时（比如名字文字长在链接外面的兄弟元素里），
 * 用这个当兜底，比硬猜 DOM 结构靠谱。
 */
function nameFromUrlSlug(href) {
  const match = href.match(/[?&]name=([^&]+)/i);
  if (!match) return null;
  let slug;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }
  return slug
      .replace(/-+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 把 "Bananaskg" 拆成 { name: "Bananas", packSize: "kg" }
 * 把 "Green Seedless Grapes500g" 拆成 { name: "Green Seedless Grapes", packSize: "500g" }
 * 拆不出规格就整段当 name，packSize 给 null
 */
function splitNameAndPackSize(rawText) {
  if (!rawText) return { name: null, packSize: null };

  // 两类规格写法：
  //  1. 数字+单位，比如 500g / 1.5l / 10pk（数字是必须的，避免误伤本身就带 g 结尾的单词）
  //  2. 纯单位词 kg / ea / pk（这几个词几乎不会是英文商品名的自然结尾，所以不强制要求数字）
  const match = rawText.match(/(\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pk)|kg|ea|pk)$/i);
  if (!match) return { name: rawText, packSize: null };

  const packSize = match[0];
  const name = rawText.slice(0, rawText.length - packSize.length).trim();
  return { name: name || rawText, packSize };
}

// 换算单价文字，比如 "$1.60/100g"、"$2.80/1L"、"$3.79 / kg"（斜杠两边允许空格）
const UNIT_PRICE_RE = /\$?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d*(?:\.\d+)?)\s*([a-zA-Z]+)/;
const UNIT_PRICE_RE_GLOBAL = new RegExp(UNIT_PRICE_RE.source, 'g');

// 规格单位统一写法，跟 Woolworths 数据里的 baseUnit 保持一致（100g / 1kg / 1L / 100mL / 1ea）
const UNIT_ALIASES = { g: 'g', kg: 'kg', ml: 'mL', l: 'L', ltr: 'L', ea: 'ea', pk: 'pk' };

// 一致性检查的容差：price 折算出的每单位价跟页面上的单位价相差超过 5% 就算可疑
const UNIT_PRICE_TOLERANCE = 0.05;

/**
 * 把 "$1.60/100g" 解析成 { unitPrice: 1.6, baseUnit: '100g' }，
 * "$2.80/1L" → { unitPrice: 2.8, baseUnit: '1L' }，"$3.79/kg" → { unitPrice: 3.79, baseUnit: '1kg' }
 * 解析不了返回 { unitPrice: null, baseUnit: null }
 */
function parseUnitPriceText(raw) {
  if (!raw) return { unitPrice: null, baseUnit: null };
  const match = raw.match(UNIT_PRICE_RE);
  if (!match) return { unitPrice: null, baseUnit: null };
  const unit = UNIT_ALIASES[match[3].toLowerCase()];
  if (!unit) return { unitPrice: null, baseUnit: null };
  const qty = match[2] ? parseFloat(match[2]) : 1;
  return { unitPrice: parseFloat(match[1]), baseUnit: `${qty}${unit}` };
}

/**
 * 把规格/单位换算成基础量：质量统一成克，体积统一成毫升，件数统一成个
 * "500g" → { amount: 500, dim: 'mass' }，"2l" → { amount: 2000, dim: 'volume' }，
 * "6 x 250ml" → { amount: 1500, dim: 'volume' }；解析不了返回 null
 */
function toBaseQuantity(text) {
  if (!text) return null;
  const match = text.trim().match(/^(?:(\d+)\s*x\s*)?(\d*(?:\.\d+)?)\s*([a-zA-Z]+)$/i);
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const qty = match[2] ? parseFloat(match[2]) : 1;
  const unit = UNIT_ALIASES[match[3].toLowerCase()];
  const factors = { g: ['mass', 1], kg: ['mass', 1000], mL: ['volume', 1], L: ['volume', 1000], ea: ['count', 1], pk: ['count', 1] };
  if (!unit || !factors[unit] || !(qty > 0)) return null;
  const [dim, factor] = factors[unit];
  return { amount: count * qty * factor, dim };
}

/**
 * 一致性检查：price 和 packSize 都有时，用 price 折算出的每单位价应该跟抓到的单位价基本一致。
 * 返回 { suspect, reason }；信息不够或量纲对不上（比如按件卖但单位价按克）时不判断，suspect=false
 */
function checkUnitPriceConsistency({ price, pricePer, packSize, unitPrice, baseUnit }) {
  if (price == null || unitPrice == null || !baseUnit) return { suspect: false, reason: null };
  // 按公斤称重卖的，price 本身就是每公斤价
  const pack = pricePer === 'kg' ? toBaseQuantity('1kg') : toBaseQuantity(packSize);
  const base = toBaseQuantity(baseUnit);
  if (!pack || !base || pack.dim !== base.dim) return { suspect: false, reason: null };

  const expected = (price / pack.amount) * base.amount;
  const diff = Math.abs(expected - unitPrice) / unitPrice;
  if (diff <= UNIT_PRICE_TOLERANCE) return { suspect: false, reason: null };
  return {
    suspect: true,
    reason: `price ${price}/${pricePer === 'kg' ? 'kg' : packSize} → ${expected.toFixed(2)}/${baseUnit}, page says ${unitPrice}/${baseUnit} (${(diff * 100).toFixed(1)}% off)`
  };
}

/**
 * 跟 $node.text() 一样取文字，但每个文本节点之间加空格，
 * 避免 "7" "99" "ea" 被拼成 "799ea" 这种分不开的样子
 */
function spacedText($node, $) {
  const parts = [];
  const walk = (nodes) => {
    nodes.each((_, n) => {
      if (n.type === 'text') {
        const t = $(n).text().trim();
        if (t) parts.push(t);
      } else if (n.type === 'tag' && n.name !== 'script' && n.name !== 'style') {
        walk($(n).contents());
      }
    });
  };
  walk($node);
  return parts.join(' ');
}

/**
 * 文本兜底方案：先把 "$x.xx/单位" 这种单位价片段删掉，再找货架价。
 * 货架价允许整数和小数之间有空白或小数点（"7 99"、"7.99"、"$7 . 99"），
 * 整数前面要么是开头、空白或 $，后面跟空白/结尾/ea/kg，避免把 "500g" 里的 500 当成价格
 */
function extractShelfPriceFromText(text) {
  if (!text) return null;
  const stripped = text.replace(UNIT_PRICE_RE_GLOBAL, ' ');
  const match = stripped.match(/(?:^|[\s$])(\d+)\s*[.\s]\s*(\d{2})(?=\s|$|ea\b|kg\b)/i);
  return match ? parseFloat(`${match[1]}.${match[2]}`) : null;
}

/**
 * 从一张商品卡片（data-testid="product-<id>-EA-000"）里按 data-testid 取值。
 * 取不到货架价元素时退回文本方案，并打印警告。
 */
function parseProductCard($card, $, chainKey, categoryLabel) {
  const testId = $card.attr('data-testid') || '';
  const href = $card.find('a[href*="/shop/product/"]').first().attr('href') || '';
  const hrefMatch = href.match(/\/shop\/product\/(\d+)_([a-z]+)_([a-z0-9]+)/i);
  const idMatch = testId.match(/^product-(\d+)-([A-Za-z]+)-/);
  const productId = hrefMatch ? hrefMatch[1] : idMatch ? idMatch[1] : null;
  const unit = hrefMatch ? hrefMatch[2].toLowerCase() : idMatch ? idMatch[2].toLowerCase() : null;
  if (!productId) return null;

  const name = $card.find('[data-testid="product-title"]').first().text().trim() || nameFromUrlSlug(href);
  const packSize = $card.find('[data-testid="product-subtitle"]').first().text().trim() || null;

  // 货架价：整数和小数是分开的两个元素
  const dollars = $card.find('[data-testid="price-dollars"]').first().text().trim();
  const cents = $card.find('[data-testid="price-cents"]').first().text().trim();
  const pricePer = $card.find('[data-testid="price-per"]').first().text().trim().toLowerCase() || null;
  let price = null;
  if (/^\d+$/.test(dollars) && /^\d{2}$/.test(cents)) {
    price = parseFloat(`${dollars}.${cents}`);
  } else {
    price = extractShelfPriceFromText(spacedText($card, $));
    console.warn(`[scrapeFoodstuffs] ${productId} "${name}": price elements not found, text fallback → ${price}`);
  }

  // 换算单价："$1.60/100g"
  const unitPriceRaw = $card.find('[data-testid="non-promo-unit-price"]').first().text().trim();
  let { unitPrice, baseUnit } = parseUnitPriceText(unitPriceRaw);
  if (unitPrice === null) {
    ({ unitPrice, baseUnit } = parseUnitPriceText(spacedText($card, $)));
    if (unitPrice !== null) {
      console.warn(`[scrapeFoodstuffs] ${productId} "${name}": unit price element not found, text fallback → ${unitPrice}/${baseUnit}`);
    }
  }

  const { suspect, reason } = checkUnitPriceConsistency({ price, pricePer, packSize, unitPrice, baseUnit });
  if (suspect) {
    console.warn(`[scrapeFoodstuffs] SUSPECT ${productId} "${name}" ${packSize || ''}: ${reason}`);
  }

  const rawImageUrl = $card.find('img').first().attr('src') || null;
  const imageUrl = rawImageUrl && rawImageUrl.includes(productId) ? rawImageUrl : null;

  const chain = CHAINS[chainKey];
  return {
    productId,
    unit,
    name,
    packSize,
    price,
    unitPrice,
    baseUnit,
    suspect,
    suspectReason: reason,
    category: categoryLabel,
    imageUrl,
    sourceUrl: chain ? chain.baseUrl + href : href,
    chain: chainKey,
    scrapedAt: new Date().toISOString(), // 对应 NFR-D1 的 updatedAt
  };
}

/**
 * 旧的文本方案：按商品链接往上找卡片，从卡片文字里抠价格。
 * 只在页面上找不到 data-testid 商品卡片时才用（页面结构变了的兜底）。
 */
function parseByProductLinks($, chainKey, categoryLabel) {
  const chain = CHAINS[chainKey];
  const products = [];

  // 商品详情页链接格式: /shop/product/{productId}_{unit}_{storeCode}?name={slug}
  // 例如: /shop/product/5028110_ea_000nw?name=avocado
  $('a[href*="/shop/product/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const match = href.match(/\/shop\/product\/(\d+)_([a-z]+)_([a-z0-9]+)/i);
    if (!match) return;

    const [, productId, unit] = match;

    // 从这个链接往上爬，找到真正包含价格的祖先节点（不再只固定找最近一层）
    const $card = findCardWithPrice($(el), $);
    const cardText = spacedText($card, $);

    // 先删掉单位价片段，再找货架价（整数和小数之间允许空白）
    const price = extractShelfPriceFromText(cardText);
    const { unitPrice, baseUnit } = parseUnitPriceText(cardText);

    // 商品名：优先用链接自身可见文字（更精确，规格能拆得干净）；
    // 如果链接文字是空的（这次实测发现 New World 有些卡片就是这样），
    // 退回用链接里的 ?name=xxx 参数兜底，保证 name 不会是空的
    const rawText = $(el).text().trim();
    const { name: nameFromText, packSize } = splitNameAndPackSize(rawText);
    const name = nameFromText || nameFromUrlSlug(href);

    const { suspect, reason } = checkUnitPriceConsistency({ price, pricePer: null, packSize, unitPrice, baseUnit });
    if (suspect) {
      console.warn(`[scrapeFoodstuffs] SUSPECT ${productId} "${name}" ${packSize || ''}: ${reason}`);
    }

    // 图片：找卡片内第一张 <img> 的 src。
    // 多加一道保险：图片文件名里通常带商品编号（比如 5028110.png），
    // 如果这个编号跟当前商品的 productId 对不上，说明抓错了（大概率是越界抓到邻居的图），
    // 宁可留空也不要存错的数据
    const rawImageUrl = $card.find('img').first().attr('src') || null;
    const imageUrl = rawImageUrl && rawImageUrl.includes(productId) ? rawImageUrl : null;

    if (productId && price !== null) {
      products.push({
        productId,
        unit,
        name,
        packSize,
        price,
        unitPrice,
        baseUnit,
        suspect,
        suspectReason: reason,
        category: categoryLabel,
        imageUrl,
        sourceUrl: chain.baseUrl + href,
        chain: chainKey,
        scrapedAt: new Date().toISOString(), // 对应 NFR-D1 的 updatedAt
      });
    }
  });
  return products;
}

/**
 * 解析一个分类页的 HTML（不联网，方便离线测试/干跑）
 * 优先按 data-testid="product-<id>-EA-000" 的商品卡片取值；
 * 页面上一张这种卡片都没有时，才退回旧的按商品链接 + 文本的方案
 */
function parseCategoryHtml(html, chainKey, categoryLabel = null) {
  const $ = cheerio.load(html);
  const $cards = $('div[itemtype*="schema.org/Product"][data-testid^="product-"]');

  let products;
  if ($cards.length > 0) {
    products = [];
    $cards.each((_, el) => {
      const product = parseProductCard($(el), $, chainKey, categoryLabel);
      if (product && product.price !== null) products.push(product);
    });
  } else {
    console.warn('[scrapeFoodstuffs] no data-testid product cards found, falling back to text parsing');
    products = parseByProductLinks($, chainKey, categoryLabel);
  }

  // 去重：同一个商品可能因为促销/推荐区块在页面里重复出现
  const seen = new Set();
  return products.filter((p) => {
    const key = `${p.productId}_${p.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 抓一个分类页，返回这一页所有商品
 *
 * 重要：下面的选择器是"占位/推测"版本，因为我在写这份代码时
 * 只能看到网页转成 Markdown 之后的文本，看不到真实的 class 名。
 * 你需要做的事（5-10分钟）：
 *   1. 浏览器打开任意一个分类页（比如 Pak'nSave 的 featured 分类）
 *   2. F12 -> 右键随便一个商品卡片 -> "检查元素"
 *   3. 找到包裹整个商品卡片的最外层元素，把它的 class 或 data 属性
 *      填进下面 PRODUCT_CARD_SELECTOR
 *   4. 同理确认价格、商品名分别是哪个子元素/属性
 *
 * 这里先用一个更"笨但更稳"的兜底方案：不依赖具体 class，
 * 直接找所有指向商品详情页的链接（/shop/product/...），
 * 因为这个 URL 规律我们已经从实测结果里确认过了，比较稳定。
 */
async function scrapeCategoryPage(chainKey, categoryUrl, categoryLabel = null) {
  const chain = CHAINS[chainKey];
  if (!chain) throw new Error(`Unknown supermarket: ${chainKey}; must be newworld or paknsave`);

  const res = await axios.get(categoryUrl, {
    headers: {
      // 伪装成正常浏览器请求，避免被简单的 UA 检测拦掉
      'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15000,
  });

  return parseCategoryHtml(res.data, chainKey, categoryLabel);
}

/**
 * 把 URL 里的 pg=N 参数替换成指定页码（如果 URL 本来没有 pg 参数，就自动加上）
 */
function withPage(url, page) {
  const u = new URL(url);
  u.searchParams.set('pg', String(page));
  return u.toString();
}

/**
 * 从第1页开始一直抓到最后一页（某一页抓到 0 个商品，就认为到头了）。
 * 加了两个保护：
 *  1. 页数上限 50 页，防止网址给错或页面结构变了导致死循环一直抓下去
 *  2. 每页之间等待一下，别对人家网站发太密集的请求（之前就因为测太频繁被 403 过一次）
 */
async function scrapeAllPages(chainKey, baseCategoryUrl, maxPages = 50, categoryLabel = null) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = withPage(baseCategoryUrl, page);
    let pageProducts;
    let retriesLeft = 2; // 遇到 429（被限速）时，最多重试 2 次再放弃
    while (true) {
      try {
        pageProducts = await scrapeCategoryPage(chainKey, url, categoryLabel);
        break;
      } catch (err) {
        const is429 = err.message && err.message.includes('429');
        if (is429 && retriesLeft > 0) {
          retriesLeft--;
          const waitSeconds = Math.round((90000 + Math.random() * 90000) / 1000);
          console.log(`Page ${page} rate-limited (429), retrying in about ${waitSeconds} seconds (retries left: ${retriesLeft})...`);
          await randomDelay(90000, 180000); // 90-180 秒随机，比之前的固定30秒更保守
          continue;
        }
        console.error(`Page ${page} failed, stopping pagination: ${err.message}`);
        return all; // 放弃这个分类剩下的页，但已经抓到的数据照样返回，不会丢
      }
    }
    if (pageProducts.length === 0) {
      console.log(`Page ${page} has no products, pagination finished`);
      break;
    }
    console.log(`Page ${page}: scraped ${pageProducts.length} products`);
    all.push(...pageProducts);
    if (page < maxPages) {
      await randomDelay(3000, 7000); // 每页之间随机歇 3-7 秒，不用固定数字
    }
  }
  return all;
}

// 命令行直接跑：
//   单页：  node scrapeFoodstuffs.js paknsave "<url>"
//   全部页： node scrapeFoodstuffs.js paknsave "<url>" --all
if (require.main === module) {
  const [, , chainKey, categoryUrl, flag] = process.argv;
  if (!chainKey || !categoryUrl) {
    console.error('Usage: node scrapeFoodstuffs.js <newworld|paknsave> <categoryURL> [--all]');
    process.exit(1);
  }

  const task =
      flag === '--all'
          ? scrapeAllPages(chainKey, categoryUrl)
          : scrapeCategoryPage(chainKey, categoryUrl);

  task
      .then((products) => {
        console.log(`\nScraped ${products.length} products in total\n`);
        console.log(JSON.stringify(products.slice(0, 5), null, 2));
        console.log(products.length > 5 ? `\n...${products.length - 5} more omitted` : '');
      })
      .catch((err) => {
        console.error('Scrape failed:', err.message);
        process.exit(1);
      });
}

/**
 * 一次性跑好几个分类，把结果全部汇总去重。
 * categoryUrls 现在传的是 [{ url, label }, ...] 这种带分类名字的对象数组，
 * 这样每条商品数据里能记住"我是从哪个大类抓来的"（对应数据库的 category 字段）。
 * 想要数据量大，靠"多跑几个分类"比"抠单个分类的精度"划算得多——
 * 超市随便一个大类下面就有好几个子分类，几个子分类加起来轻松破百。
 */
async function scrapeMultipleCategories(chainKey, categoryUrls, useAllPages = true) {
  const all = [];
  for (const { url, label } of categoryUrls) {
    console.log(`\n===== Scraping category: ${label || '(unnamed)'} - ${url} =====`);
    const products = useAllPages
        ? await scrapeAllPages(chainKey, url, 50, label)
        : await scrapeCategoryPage(chainKey, url, label);
    all.push(...products);
    // 换分类之间也歇一下，别对网站发太密集的请求（随机 5-12 秒）
    await randomDelay(5000, 12000);
  }
  // 按 productId+unit 去重（不同分类页面之间可能重复出现同一个商品）
  const seen = new Set();
  return all.filter((p) => {
    const key = `${p.productId}_${p.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  scrapeCategoryPage,
  scrapeAllPages,
  scrapeMultipleCategories,
  parseCategoryHtml,
  parseUnitPriceText,
  checkUnitPriceConsistency,
  extractShelfPriceFromText,
  CHAINS,
};
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

    if (/\d+[.\s]\d{2}\b/.test($node.text())) {
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
  if (!chain) throw new Error(`未知超市: ${chainKey}，只能是 newworld 或 paknsave`);

  const res = await axios.get(categoryUrl, {
    headers: {
      // 伪装成正常浏览器请求，避免被简单的 UA 检测拦掉
      'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(res.data);
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
    const cardText = $card.text();

    // 价格通常形如 "7.39" 或 "7 39"（取决于页面渲染方式），
    // 用正则从卡片文本里抓第一个看起来像价格的数字
    const priceMatch = cardText.match(/\$?(\d+)[.\s](\d{2})\b/);
    const price = priceMatch ? parseFloat(`${priceMatch[1]}.${priceMatch[2]}`) : null;

    // 换算单价：页面上像 "$3.79/1kg"、"$1.25/ea" 这种，专门用来跨商品比较的折算价。
    // 跟主价格的区别是它后面一定跟着 "/单位"，用这个特征区分开，不会跟主价格混。
    const unitPriceMatch = cardText.match(/\$?(\d+\.\d{2})\/([a-zA-Z0-9.]+)/);
    const unitPrice = unitPriceMatch ? parseFloat(unitPriceMatch[1]) : null;
    const baseUnit = unitPriceMatch ? unitPriceMatch[2] : null;

    // 商品名：优先用链接自身可见文字（更精确，规格能拆得干净）；
    // 如果链接文字是空的（这次实测发现 New World 有些卡片就是这样），
    // 退回用链接里的 ?name=xxx 参数兜底，保证 name 不会是空的
    const rawText = $(el).text().trim();
    const { name: nameFromText, packSize } = splitNameAndPackSize(rawText);
    const name = nameFromText || nameFromUrlSlug(href);

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
        category: categoryLabel,
        imageUrl,
        sourceUrl: chain.baseUrl + href,
        chain: chainKey,
        scrapedAt: new Date().toISOString(), // 对应 NFR-D1 的 updatedAt
      });
    }
  });

  // 去重：同一个商品可能因为促销/推荐区块在页面里重复出现
  const seen = new Set();
  const deduped = products.filter((p) => {
    const key = `${p.productId}_${p.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped;
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
          console.log(`第 ${page} 页被限速(429)，等待约 ${waitSeconds} 秒后重试（剩余重试次数: ${retriesLeft}）...`);
          await randomDelay(90000, 180000); // 90-180 秒随机，比之前的固定30秒更保守
          continue;
        }
        console.error(`第 ${page} 页抓取失败，停止翻页: ${err.message}`);
        return all; // 放弃这个分类剩下的页，但已经抓到的数据照样返回，不会丢
      }
    }
    if (pageProducts.length === 0) {
      console.log(`第 ${page} 页没有商品了，翻页结束`);
      break;
    }
    console.log(`第 ${page} 页抓到 ${pageProducts.length} 个商品`);
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
    console.error('用法: node scrapeFoodstuffs.js <newworld|paknsave> <分类URL> [--all]');
    process.exit(1);
  }

  const task =
      flag === '--all'
          ? scrapeAllPages(chainKey, categoryUrl)
          : scrapeCategoryPage(chainKey, categoryUrl);

  task
      .then((products) => {
        console.log(`\n共抓到 ${products.length} 个商品\n`);
        console.log(JSON.stringify(products.slice(0, 5), null, 2));
        console.log(products.length > 5 ? `\n...还有 ${products.length - 5} 个，已省略` : '');
      })
      .catch((err) => {
        console.error('抓取失败:', err.message);
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
    console.log(`\n===== 开始抓分类: ${label || '(未命名)'} - ${url} =====`);
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

module.exports = { scrapeCategoryPage, scrapeAllPages, scrapeMultipleCategories, CHAINS };
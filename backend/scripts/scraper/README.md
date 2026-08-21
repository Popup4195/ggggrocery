# New World / Pak'nSave 抓取脚本使用说明

## 1. 安装依赖

```bash
npm install axios cheerio
```

## 2. 先跑一次，看看兜底方案能抓到多少

```bash
node scrapeFoodstuffs.js paknsave "https://www.paknsave.co.nz/shop/category/fruit-and-vegetables/fruit?pg=1"
```

这个版本用的是"笨但稳"的兜底选择器（找所有 `/shop/product/` 链接 + 正则抓价格），
不依赖具体 CSS class，所以大概率能直接跑通、抓到大部分商品。

## 3. 如果想要更精确（商品名/价格更干净），照这几步调整选择器

我写代码时只能看到网页转成 Markdown 之后的文本，看不到真实的 HTML class 名，
所以 `$card.closest('div')` 这种写法是占位的，能跑但不够精确。想优化的话：

1. 浏览器打开任意分类页，比如上面那个 URL
2. 按 F12 打开开发者工具，右键点一个商品卡片 -> "检查"
3. 找到包住整张卡片（图片+名字+价格）的最外层元素，记下它的 class
4. 把 `scrapeFoodstuffs.js` 里的 `closest('div')` 换成 `closest('.你找到的class')`
5. 同理，价格和商品名如果有专门的 class（比如 `.price`、`.product-name`），
   也可以直接用 `$card.find('.price').text()` 替代现在的正则猜测，更准。

Pak'nSave 和 New World 页面结构几乎一样，调好一个，另一个大概率照抄就行。

## 4. 分页

分类页 URL 带 `?pg=1` 参数，页面底部有分页信息（比如 "Showing 1-50 of 502 products"）。
要抓完一个分类，简单粗暴的做法：写个循环从 `pg=1` 递增，直到某一页返回 0 个商品就停。

```js
async function scrapeAllPages(chainKey, baseCategoryUrl) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${baseCategoryUrl}?pg=${page}`;
    const products = await scrapeCategoryPage(chainKey, url);
    if (products.length === 0) break;
    all.push(...products);
    page++;
  }
  return all;
}
```

## 5. 接入项目：seed.js + NFR-D1

抓完拿到的每条数据长这样：

```js
{
  productId: '5028110',
  unit: 'ea',
  name: 'Avocado',
  price: 1.49,
  imageUrl: 'https://...',
  sourceUrl: 'https://www.paknsave.co.nz/shop/product/5028110_ea_000pns?name=avocado',
  chain: 'paknsave',
  scrapedAt: '2026-08-18T...' // 这个字段直接对应 PriceSnapshot 的 updatedAt
}
```

把这些数据 upsert 进 Mongoose 的 PriceSnapshot 集合时，直接把 `scrapedAt` 存进
`updatedAt` 字段（如果模型里还没有这个字段，先加上）。前端读的时候，用这个时间戳
算"更新于 X 小时前"，超过 24 小时标 stale——这部分逻辑归 NFR-D1，跟这个抓取脚本
本身没有依赖关系，可以并行做。

## 6. 每天跑一次（"每天抓一次全量"）

最简单的做法：用 `node-cron` 包，在后端启动时注册一个定时任务；
或者更省事，直接在服务器上配一条系统 crontab，每天固定时间跑
`node scrapeFoodstuffs.js ...` 加上把结果写数据库的逻辑。
两种方式效果一样，选你们更熟悉的就行，不需要为了这个再学新工具。

## 7. Countdown/Woolworths 不在这份脚本里

Countdown（现改名 Woolworths NZ）官网是纯前端渲染的 SPA，这份 cheerio 方案对它
无效，需要单独用 Playwright 处理，建议拆成独立任务，不要跟这两家混在一起改。
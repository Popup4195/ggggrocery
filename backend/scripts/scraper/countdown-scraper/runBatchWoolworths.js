/**
 * Woolworths (原 Countdown) 批量抓取脚本：一次跑7个核心大类，共用一个浏览器实例。
 *
 * ⚠️ 会弹出真实 Chrome 窗口，需要你守在电脑前，这段时间电脑不能关机/休眠。
 *
 * 用法：
 *   node runBatchWoolworths.js
 */
const fs = require('fs');
const { chromium } = require('playwright');
const { scrapeAllPages } = require('./scrapeWoolworths.js');

// 跟 Pak'nSave/New World 那次商定的范围保持一致：7个日常核心大类
const CATEGORIES = [
  { path: '/shop/browse/fruit-veg', label: 'Fruit & Vegetables' },
  { path: '/shop/browse/meat-poultry', label: 'Meat, Poultry & Seafood' },
  { path: '/shop/browse/fridge-deli', label: 'Fridge, Deli & Eggs' },
  { path: '/shop/browse/bakery', label: 'Bakery' },
  { path: '/shop/browse/frozen', label: 'Frozen' },
  { path: '/shop/browse/pantry', label: 'Pantry' },
  { path: '/shop/browse/drinks', label: 'Hot & Cold Drinks' },
];

const BASE_URL = 'https://www.woolworths.co.nz';

function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('启动浏览器（会弹出真实 Chrome 窗口，请不要关闭它，让它自己跑）...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();

  const all = [];
  const outFile = 'countdown-products.json';

  try {
    for (let i = 0; i < CATEGORIES.length; i++) {
      const { path, label } = CATEGORIES[i];
      const url = `${BASE_URL}${path}`;
      console.log(`\n===== 开始抓分类: ${label} - ${url} =====`);

      const products = await scrapeAllPages(page, url, label);
      all.push(...products);

      console.log(`[${label}] 抓到 ${products.length} 个商品`);

      // 每跑完一个大类就存一次盘，不等全部跑完才存——
      // 万一中途崩了（被拦截/浏览器意外关掉/电脑休眠），已经抓到的数据不会丢，
      // 不用整个从头再来
      fs.writeFileSync(outFile, JSON.stringify(all, null, 2), 'utf-8');
      console.log(`（已保存进度：目前共 ${all.length} 个商品）`);

      // 换分类之间也歇一下（随机5-12秒），跟 Foodstuffs 那边保持一致的谨慎节奏
      if (i < CATEGORIES.length - 1) {
        await randomDelay(5000, 12000);
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\n========================================');
  console.log(`共抓到 ${all.length} 个商品，已存到 ${outFile}`);
  console.log('========================================');
}

main().catch((err) => {
  console.error('批量抓取失败:', err.message);
  process.exit(1);
});

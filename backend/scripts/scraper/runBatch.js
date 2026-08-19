/**
 * 批量抓取脚本：一次跑好几个分类，把结果存成 JSON 文件。
 *
 * 用法：
 *   node runBatch.js paknsave
 *   node runBatch.js newworld
 */
const fs = require('fs');
const { scrapeMultipleCategories } = require('./scrapeFoodstuffs.js');

// 跟队友/tutor 商定过的范围：先覆盖日常买菜会用到的 7 个核心大类，
// 不抓 Pets、Baby & Toddler、Health & Body、Beer Wine & Cider 这些低频类目。
// 用的是大类本身的分类页网址（不是子分类），大类页面自己会翻页展示这个大类下所有商品，
// 不需要再逐个子分类枚举网址。
// label 就是存进数据库 category 字段的值，用来支撑网页上的分类筛选功能。
const CATEGORIES = [
    { path: '/shop/category/fruit-and-vegetables', label: 'Fruit & Vegetables' },
    { path: '/shop/category/meat-poultry-and-seafood', label: 'Meat, Poultry & Seafood' },
    { path: '/shop/category/fridge-deli-and-eggs', label: 'Fridge, Deli & Eggs' },
    { path: '/shop/category/bakery', label: 'Bakery' },
    { path: '/shop/category/frozen', label: 'Frozen' },
    { path: '/shop/category/pantry', label: 'Pantry' },
    { path: '/shop/category/hot-and-cold-drinks', label: 'Hot & Cold Drinks' },
];

/**
 * 按日期轮换分类顺序，避免同一个类目每天都排在最后、天天被限速拦掉。
 * 正好 7 个类目对应一周 7 天，一周下来每个类目都轮到过一次"排第一个抓"。
 *
 * 举例：今天是这一年的第 100 天，100 % 7 = 2，那今天顺序就是从下标2开始转一圈：
 * [Fridge, Bakery, Frozen, Pantry, Hot&Cold, Fruit&Veg, Meat]
 */
function rotateByDate(arr) {
    const dayOfYear = Math.floor(
        (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
    );
    const offset = dayOfYear % arr.length;
    return [...arr.slice(offset), ...arr.slice(0, offset)];
}

const BASE_URLS = {
    newworld: 'https://www.newworld.co.nz',
    paknsave: 'https://www.paknsave.co.nz',
};

/**
 * 跑一个超市牌子的完整批量抓取（7个大类，带日期轮换），存成 JSON 文件。
 * 拆成独立函数是为了能被"每日自动刷新"的编排脚本调用，
 * 不再只能靠命令行手动跑。
 */
async function runBatchForChain(chainKey) {
    if (!chainKey || !BASE_URLS[chainKey]) {
        throw new Error('chainKey 必须是 newworld 或 paknsave');
    }

    const orderedCategories = rotateByDate(CATEGORIES);
    console.log(`今天的抓取顺序: ${orderedCategories.map((c) => c.label).join(' -> ')}`);
    const categoryUrls = orderedCategories.map(({ path, label }) => ({
        url: `${BASE_URLS[chainKey]}${path}?pg=1`,
        label,
    }));

    const products = await scrapeMultipleCategories(chainKey, categoryUrls);

    const outFile = `${chainKey}-products.json`;
    fs.writeFileSync(outFile, JSON.stringify(products, null, 2), 'utf-8');

    console.log(`\n========================================`);
    console.log(`共抓到 ${products.length} 个商品，已存到 ${outFile}`);
    console.log(`========================================`);

    return { chainKey, outFile, count: products.length };
}

// 命令行直接跑：node runBatch.js paknsave
if (require.main === module) {
    const chainKey = process.argv[2];
    if (!chainKey || !BASE_URLS[chainKey]) {
        console.error('用法: node runBatch.js <newworld|paknsave>');
        process.exit(1);
    }
    runBatchForChain(chainKey).catch((err) => {
        console.error('批量抓取失败:', err.message);
        process.exit(1);
    });
}

module.exports = { runBatchForChain, CATEGORIES, rotateByDate };
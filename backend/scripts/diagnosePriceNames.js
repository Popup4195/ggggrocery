/**
 * 诊断脚本：检查线上 PriceSnapshot 集合里的 productName
 * 到底是 seed.js 时代的"通用名"（bread/milk/eggs...）
 * 还是爬虫时代的"具体商品名"（vogel's bread 700g / royal gala apples...）
 *
 * 用法（项目根目录下跑，需要能读到 .env.local）：
 *   node backend/scripts/diagnosePriceNames.js
 *
 * 不会修改任何数据，纯只读统计。
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const PriceSnapshot = require('../models/PriceSnapshot');

// 用户实际会输入的常见简单词，用来测试"精确匹配"现在还能不能查到东西
const COMMON_USER_INPUTS = [
    'bread', 'milk', 'eggs', 'butter', 'cheese', 'chicken', 'rice', 'apples',
    'banana', 'bananas', 'yoghurt', 'yogurt', 'tomato', 'tomatoes', 'onion',
    'potato', 'potatoes', 'pasta', 'flour', 'sugar', 'coffee', 'tea'
];

// 粗略启发式：判断一个 productName "看起来像"旧的通用名，还是新的具体商品名
// 通用名特征：1-2个单词，没有数字，没有常见规格单位词，没有撇号(品牌名 's)
function looksGeneric(name) {
    const hasDigit = /\d/.test(name);
    const hasApostrophe = /'/.test(name);
    const hasSizeUnit = /\b(g|kg|ml|l|pk|ea|pack|kgm)\b/i.test(name);
    const wordCount = name.trim().split(/\s+/).length;
    return !hasDigit && !hasApostrophe && !hasSizeUnit && wordCount <= 2;
}

async function main() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('没有找到 MONGODB_URI，检查 .env.local');
        process.exit(1);
    }

    console.log('连接数据库...');
    await mongoose.connect(mongoUri);
    console.log('已连接\n');

    // ========== 1. 总量 & 按 chain 分布 ==========
    const total = await PriceSnapshot.countDocuments({});
    console.log(`========== 总量 ==========`);
    console.log(`PriceSnapshot 总条数: ${total}\n`);

    const byChain = await PriceSnapshot.aggregate([
        { $group: { _id: '$chainId', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    console.log('按超市分布:');
    byChain.forEach(c => console.log(`  ${c._id}: ${c.count} 条`));
    console.log('');

    // ========== 2. 通用名 vs 具体名 粗略分类 ==========
    const allDocs = await PriceSnapshot.find({}, { productName: 1, chainId: 1 }).lean();

    const genericDocs = allDocs.filter(d => looksGeneric(d.productName));
    const specificDocs = allDocs.filter(d => !looksGeneric(d.productName));

    console.log(`========== 通用名 vs 具体名（启发式判断，仅供参考）==========`);
    console.log(`看起来像"旧通用名"（如 bread/milk）: ${genericDocs.length} 条`);
    console.log(`看起来像"新具体名"（如 vogel's bread 700g）: ${specificDocs.length} 条\n`);

    console.log('通用名样例（最多20条）:');
    genericDocs.slice(0, 20).forEach(d => console.log(`  [${d.chainId}] "${d.productName}"`));
    console.log('');

    console.log('具体名样例（最多20条）:');
    specificDocs.slice(0, 20).forEach(d => console.log(`  [${d.chainId}] "${d.productName}"`));
    console.log('');

    // ========== 3. 用常见用户输入词做"精确匹配"测试 ==========
    console.log(`========== 精确匹配测试：模拟用户输入常见词 ==========`);
    console.log('（这一步复现的就是当前 priceService.js 里 $in 精确匹配的行为）\n');

    for (const term of COMMON_USER_INPUTS) {
        const exactMatches = await PriceSnapshot.find({ productName: term }).lean();
        const containsMatches = await PriceSnapshot.find({
            productName: { $regex: term, $options: 'i' }
        }).lean();

        const exactChains = [...new Set(exactMatches.map(d => d.chainId))];
        const containsChains = [...new Set(containsMatches.map(d => d.chainId))];

        const status = exactMatches.length > 0 ? '✅ 精确匹配上了' : '❌ 精确匹配失败';
        console.log(
            `"${term}": 精确匹配 ${exactMatches.length} 条 [${exactChains.join(',') || '无'}] | ` +
            `包含匹配 ${containsMatches.length} 条 [${containsChains.join(',') || '无'}]  ${status}`
        );
    }
    console.log('');

    // ========== 4. 检查有没有重复/冲突：同一个具体商品名，不同大小写/空格变体 ==========
    console.log(`========== 潜在重复项检查（去除空格后 productName 撞车的情况）==========`);
    const normalizedMap = {};
    allDocs.forEach(d => {
        const norm = `${d.chainId}::${d.productName.replace(/\s+/g, '')}`;
        if (!normalizedMap[norm]) normalizedMap[norm] = [];
        normalizedMap[norm].push(d.productName);
    });
    const dupes = Object.entries(normalizedMap).filter(([, names]) => new Set(names).size > 1);
    if (dupes.length === 0) {
        console.log('没发现明显的空格变体重复。\n');
    } else {
        console.log(`发现 ${dupes.length} 组可能的重复（前10组）:`);
        dupes.slice(0, 10).forEach(([key, names]) => {
            console.log(`  ${key}: ${[...new Set(names)].join(' | ')}`);
        });
        console.log('');
    }

    await mongoose.disconnect();
    console.log('诊断完成。');
}

main().catch(err => {
    console.error('诊断失败:', err);
    process.exit(1);
});

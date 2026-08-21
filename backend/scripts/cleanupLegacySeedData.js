/**
 * 清理 seed.js 时代遗留的通用类目名记录（bread/milk/eggs...）。
 *
 * 背景：这8个词是 seed.js 里的类目名（backend/seed.js 第289行 productName.toLowerCase()），
 * 切换到爬虫数据后这些旧记录没有被清理，导致：
 *   - productNameMatch.js 的 pickBestMatch() 优先选"完全同名"的记录，
 *   - 用户输入 "bread" 这类常见词时，会优先匹配到这条可能很久没更新的旧数据，
 *     而不是几百条新鲜爬虫数据里最便宜的那条，违背了"比价"这个产品的初衷。
 *
 * 用法：
 *   node backend/scripts/cleanupLegacySeedData.js            # 只打印会删除什么，不实际删除
 *   node backend/scripts/cleanupLegacySeedData.js --confirm  # 真正执行删除
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const PriceSnapshot = require('../models/PriceSnapshot');

// 跟 backend/seed.js 里的类目名保持一致（写死在这里，不做任何猜测/模糊匹配，
// 确保这个脚本绝对不会误删爬虫抓来的真实数据）
const LEGACY_SEED_NAMES = [
    'bread', 'eggs', 'milk', 'butter', 'cheese', 'chicken', 'rice', 'apples'
];

async function main() {
    const isConfirmed = process.argv.includes('--confirm');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('没有找到 MONGODB_URI，检查 .env.local');
        process.exit(1);
    }

    console.log('连接数据库...');
    await mongoose.connect(mongoUri);
    console.log('已连接\n');

    const query = { productName: { $in: LEGACY_SEED_NAMES } };
    const matched = await PriceSnapshot.find(query).lean();

    if (matched.length === 0) {
        console.log('没有找到遗留的 seed 数据，不需要清理。');
        await mongoose.disconnect();
        return;
    }

    console.log(`找到 ${matched.length} 条遗留记录:\n`);
    matched.forEach(d => {
        console.log(
            `  [${d.chainId}] "${d.productName}"  price=${d.price}  ` +
            `lastUpdated=${d.lastUpdated ? new Date(d.lastUpdated).toISOString() : '(无)'}`
        );
    });
    console.log('');

    if (!isConfirmed) {
        console.log('这是 dry-run，没有删除任何数据。');
        console.log('确认无误后加 --confirm 参数重新运行以实际删除：');
        console.log('  node backend/scripts/cleanupLegacySeedData.js --confirm');
    } else {
        const result = await PriceSnapshot.deleteMany(query);
        console.log(`已删除 ${result.deletedCount} 条记录。`);
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('清理失败:', err);
    process.exit(1);
});

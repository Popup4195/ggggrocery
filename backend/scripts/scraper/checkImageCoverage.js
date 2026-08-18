/**
 * 快速统计一下数据库里有多少条数据带了图片链接，多少条是空的。
 * 用法: node checkImageCoverage.js
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const PriceSnapshot = require('../../models/PriceSnapshot.js');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);

    const total = await PriceSnapshot.countDocuments({});
    const withImage = await PriceSnapshot.countDocuments({
        imageUrl: { $ne: null, $exists: true },
    });
    const withoutImage = total - withImage;

    console.log('========================================');
    console.log(`数据库总条数: ${total}`);
    console.log(`有图片链接: ${withImage} (${((withImage / total) * 100).toFixed(1)}%)`);
    console.log(`没有图片链接: ${withoutImage} (${((withoutImage / total) * 100).toFixed(1)}%)`);
    console.log('========================================');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('查询失败:', err.message);
    process.exit(1);
});
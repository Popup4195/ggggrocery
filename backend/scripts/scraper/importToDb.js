/**
 * 把抓取到的 JSON 数据导入 MongoDB 的 PriceSnapshot 集合。
 *
 * 用法：
 *   node importToDb.js paknsave-products.json
 *   node importToDb.js newworld-products.json
 *
 * 核心逻辑：
 *   1. 按 productName + chainId 找有没有已存在的记录（跟 PriceSnapshot 的唯一索引对齐）
 *   2. 不存在就新建
 *   3. 存在就更新——但如果这次抓到的某个字段是 null/空（比如这次没抓到 unitPrice），
 *      不会用 null 把数据库里已经有的正确值冲掉，只更新"这次真的抓到新值"的字段
 *   4. lastUpdated 每次都会更新成当前时间（对应 NFR-D1，不管字段值变没变，
 *      只要抓取动作发生了，就代表这条数据被"确认检查过一次"）
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// 复用你们项目已有的模型，保证 schema/唯一索引完全一致，不需要重新定义一遍
const PriceSnapshot = require('../../models/PriceSnapshot.js');

// 把抓取脚本里用的 unit 代码（kgm/ea）转成人类可读的 baseUnit（如果这条数据本身没有从
// 页面上抽到 unitPrice 对应的 baseUnit，就退回用这个粗略映射，好过完全空着）
function fallbackBaseUnit(rawUnit) {
    const map = { kgm: 'kg', ea: 'ea', ml: 'ml', ltr: 'l' };
    return map[rawUnit] || rawUnit || '';
}

/**
 * 把抓取脚本产出的一条商品对象，转换成 PriceSnapshot 需要的字段格式
 */
function toSnapshotFields(item) {
    return {
        productName: item.name,
        chainId: item.chain,
        price: item.price,
        unit: item.unit || '',
        baseUnit: item.baseUnit || fallbackBaseUnit(item.unit),
        unitPrice: item.unitPrice,
        category: item.category || '',
        imageUrl: item.imageUrl,
        lastUpdated: item.scrapedAt ? new Date(item.scrapedAt) : new Date(),
    };
}

async function importFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const items = JSON.parse(raw);

    let created = 0;
    let updated = 0;
    let skippedNoName = 0;

    for (const item of items) {
        if (!item.name) {
            skippedNoName++;
            continue; // 没有商品名的数据没法存（productName 是必填），直接跳过
        }

        const fields = toSnapshotFields(item);
        const existing = await PriceSnapshot.findOne({
            productName: fields.productName.toLowerCase().trim(),
            chainId: fields.chainId.toLowerCase().trim(),
        });

        if (!existing) {
            await PriceSnapshot.create(fields);
            created++;
            continue;
        }

        // 已经存在：只更新"这次真的抓到值"的字段，null/undefined 的字段不动它，
        // 避免这次抓漏了某个字段，反而把数据库里本来是对的值给冲掉
        const updateFields = { lastUpdated: fields.lastUpdated };
        for (const key of ['price', 'unit', 'baseUnit', 'unitPrice', 'category', 'imageUrl']) {
            if (fields[key] !== null && fields[key] !== undefined && fields[key] !== '') {
                updateFields[key] = fields[key];
            }
        }
        await PriceSnapshot.updateOne({ _id: existing._id }, { $set: updateFields });
        updated++;
    }

    return { created, updated, skippedNoName, total: items.length };
}

async function main() {
    const fileArg = process.argv[2];
    if (!fileArg) {
        console.error('用法: node importToDb.js <json文件路径>');
        process.exit(1);
    }

    const filePath = path.resolve(fileArg);
    if (!fs.existsSync(filePath)) {
        console.error(`找不到文件: ${filePath}`);
        process.exit(1);
    }

    // 复用项目根目录 .env.local 里已经配好的 MONGODB_URI，不用重新配一遍连接
    require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('没有找到 MONGODB_URI，检查一下项目根目录的 .env.local 文件');
        process.exit(1);
    }

    console.log('连接数据库...');
    await mongoose.connect(mongoUri);
    console.log('数据库已连接，开始导入...\n');

    const result = await importFile(filePath);

    console.log('\n========================================');
    console.log(`文件: ${fileArg}`);
    console.log(`总数据: ${result.total} 条`);
    console.log(`新建: ${result.created} 条`);
    console.log(`更新: ${result.updated} 条`);
    if (result.skippedNoName > 0) {
        console.log(`跳过(没有商品名): ${result.skippedNoName} 条`);
    }
    console.log('========================================');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('导入失败:', err.message);
    process.exit(1);
});
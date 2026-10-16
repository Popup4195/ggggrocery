/**
 * 本地推算 unitPrice（换算单价），不需要重新访问网站。
 *
 * 原理：unitPrice 本质上是"把价格换算成统一单位方便比较"，
 * 换算所需要的原材料（price + packSize/unit）我们本地 JSON 文件里已经有了，
 * 不需要重新抓网页。
 *
 * 换算规则：
 *   1. unit 是 "kgm"（按公斤称重卖）→ price 本身已经是"每公斤价"，直接用，baseUnit = "kg"
 *   2. packSize 能解析出具体重量（比如 "500g"、"1kg"）→ 换算成"每公斤价"，baseUnit = "kg"
 *   3. packSize 能解析出具体容量（比如 "500ml"、"1l"）→ 换算成"每升价"，baseUnit = "L"
 *   4. 剩下的（比如 "ea"、"10pk" 这种按件/按包卖，没有具体重量容量）→
 *      unitPrice 就等于 price 本身，baseUnit = "ea"，代表"这是按件算的，
 *      只能跟同样按件卖的商品比，不能直接跟按公斤卖的比"
 *
 * 用法：
 *   node backfillUnitPrice.js paknsave-products.json
 *   node backfillUnitPrice.js newworld-products.json
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const PriceSnapshot = require('../../models/PriceSnapshot.js');

/**
 * 从 packSize 字符串和原始 unit 代码，推算出 { unitPrice, baseUnit }
 */
function deriveUnitPrice(price, unit, packSize) {
  if (price === null || price === undefined) {
    return { unitPrice: null, baseUnit: null };
  }

  // 规则1: 按公斤称重卖的，price 本身已经是每公斤价
  if (unit === 'kgm') {
    return { unitPrice: price, baseUnit: 'kg' };
  }

  if (packSize) {
    // 规则2: 能解析出具体克数/公斤数
    const gramsMatch = packSize.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
    if (gramsMatch) {
      const kg = parseFloat(gramsMatch[1]);
      return { unitPrice: Math.round((price / kg) * 100) / 100, baseUnit: 'kg' };
    }
    const gMatch = packSize.match(/^(\d+(?:\.\d+)?)\s*g$/i);
    if (gMatch) {
      const grams = parseFloat(gMatch[1]);
      const pricePerKg = (price / grams) * 1000;
      return { unitPrice: Math.round(pricePerKg * 100) / 100, baseUnit: 'kg' };
    }

    // 规则3: 能解析出具体升数/毫升数
    const literMatch = packSize.match(/^(\d+(?:\.\d+)?)\s*l$/i);
    if (literMatch) {
      const liters = parseFloat(literMatch[1]);
      return { unitPrice: Math.round((price / liters) * 100) / 100, baseUnit: 'L' };
    }
    const mlMatch = packSize.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
    if (mlMatch) {
      const ml = parseFloat(mlMatch[1]);
      const pricePerLiter = (price / ml) * 1000;
      return { unitPrice: Math.round(pricePerLiter * 100) / 100, baseUnit: 'L' };
    }
  }

  // 规则4: 剩下的（"ea"、"10pk" 这种按件卖，没有具体重量容量信息）
  // 直接用 price 本身当 unitPrice，baseUnit 标成 "ea"，
  // 代表这个值只能跟同样按件卖的商品比，不能跨单位比较
  return { unitPrice: price, baseUnit: 'ea' };
}

async function backfillFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const items = JSON.parse(raw);

  let updated = 0;
  let skippedNoName = 0;
  let skippedAlreadyHasUnitPrice = 0;

  for (const item of items) {
    if (!item.name) {
      skippedNoName++;
      continue;
    }

    const productName = item.name.toLowerCase().trim();
    const chainId = item.chain.toLowerCase().trim();

    const existing = await PriceSnapshot.findOne({ productName, chainId });
    if (!existing) continue; // 数据库里没有这条，跳过（理论上不该发生，因为都导入过了）

    // 如果这条记录已经有 unitPrice 了（比如之前已经用真实抽取值补上过），
    // 就不要用这个"本地推算"的近似值去覆盖更精确的真实值
    if (existing.unitPrice !== null && existing.unitPrice !== undefined) {
      skippedAlreadyHasUnitPrice++;
      continue;
    }

    const { unitPrice, baseUnit } = deriveUnitPrice(item.price, item.unit, item.packSize);
    if (unitPrice === null) continue;

    await PriceSnapshot.updateOne(
        { _id: existing._id },
        { $set: { unitPrice, baseUnit, lastUpdated: new Date() } }
    );
    updated++;
  }

  return { updated, skippedNoName, skippedAlreadyHasUnitPrice, total: items.length };
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node backfillUnitPrice.js <path to json file>');
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI not found; check the .env.local file in the project root');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(mongoUri);
  console.log('Database connected, starting local derivation + backfill...\n');

  const result = await backfillFile(filePath);

  console.log('\n========================================');
  console.log(`File: ${fileArg}`);
  console.log(`Total records: ${result.total}`);
  console.log(`unitPrice backfilled: ${result.updated}`);
  console.log(`Skipped (already has unitPrice, not overwritten): ${result.skippedAlreadyHasUnitPrice}`);
  if (result.skippedNoName > 0) {
    console.log(`Skipped (no product name): ${result.skippedNoName}`);
  }
  console.log('========================================');

  await mongoose.disconnect();
}

// 命令行直接跑：node backfillUnitPrice.js <json文件路径>
if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  });
}

module.exports = { backfillFile, deriveUnitPrice };
/**
 * 用数据文件里的真实分店替换 seed.js 里的 9 家假超市（只动 Branch 集合里 type=supermarket 的记录）。
 *
 * 数据来源：backend/scripts/data/wellington_branches_clean.json
 * 不会触碰：Chain、PriceSnapshot、ShoppingList，以及 Branch 里的加油站（fuel_station）记录。
 *
 * 用法：
 *   node backend/scripts/updateBranches.js          # 干跑（默认）：只读，打印将要做什么
 *   node backend/scripts/updateBranches.js --apply  # 真正写入：upsert 数据文件里的全部分店，再删除旧的假超市
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const Branch = require('../models/Branch');
const Chain = require('../models/Chain');
const PriceSnapshot = require('../models/PriceSnapshot');
const ShoppingList = require('../models/ShoppingList');

const DATA_FILE = path.resolve(__dirname, 'data/wellington_branches_clean.json');

// seed.js 里的 9 家假超市，写死在这里，删除只限于这几个 branchId
const OLD_SEED_BRANCH_IDS = [
    'paknsave_porirua', 'paknsave_kilbirnie', 'paknsave_wellington',
    'newworld_chaffers', 'newworld_miramar', 'newworld_porirua',
    'countdown_tearo', 'countdown_newtown', 'countdown_johnsonville'
];

const VALID_CHAINS = ['paknsave', 'newworld', 'countdown'];

// Branch.address 是 required，空字符串也过不了校验，所以没有地址时写一个可读的占位文本
const MISSING_ADDRESS = 'Address not available';

// 把数据文件里的一条记录映射成 Branch schema 的字段（跟 seed.js 里超市记录的写法一致）
function toBranchFields(item) {
    const address = typeof item.address === 'string' && item.address.trim()
        ? item.address.trim()
        : MISSING_ADDRESS;
    return {
        branchId: item.branchId,
        chainId: item.chainId,
        name: item.name,
        address,
        latitude: item.lat,
        longitude: item.lng,
        type: 'supermarket',
        isActive: true
    };
}

async function countAll() {
    return {
        supermarkets: await Branch.countDocuments({ type: 'supermarket' }),
        fuelStations: await Branch.countDocuments({ type: 'fuel_station' }),
        branchesTotal: await Branch.countDocuments({}),
        chains: await Chain.countDocuments({}),
        priceSnapshots: await PriceSnapshot.countDocuments({}),
        shoppingLists: await ShoppingList.countDocuments({})
    };
}

function printCounts(label, c) {
    console.log(label);
    console.log(`  Branch (supermarket):   ${c.supermarkets}`);
    console.log(`  Branch (fuel_station):  ${c.fuelStations}`);
    console.log(`  Branch (total):         ${c.branchesTotal}`);
    console.log(`  Chain:                  ${c.chains}`);
    console.log(`  PriceSnapshot:          ${c.priceSnapshots}`);
    console.log(`  ShoppingList:           ${c.shoppingLists}`);
    console.log('');
}

async function main() {
    const isApply = process.argv.includes('--apply');

    // === 读数据并在连数据库之前全部校验，有一条不对就直接停 ===
    const items = require(DATA_FILE);
    const docs = items.map(toBranchFields);

    const ids = new Set();
    for (const d of docs) {
        if (ids.has(d.branchId)) throw new Error(`Duplicate branchId in data file: ${d.branchId}`);
        ids.add(d.branchId);
        if (!VALID_CHAINS.includes(d.chainId)) throw new Error(`Invalid chainId for ${d.branchId}: ${d.chainId}`);
        try {
            await new Branch(d).validate();
        } catch (err) {
            throw new Error(`Validation failed for ${d.branchId}: ${err.message}`);
        }
    }

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('MONGODB_URI not found; check the .env.local file in the project root');
        process.exit(1);
    }

    console.log(`Mode: ${isApply ? 'APPLY (will write)' : 'DRY-RUN (read only)'}`);
    console.log('Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('Database connected\n');

    // (a) 现有记录数
    const before = await countAll();
    printCounts('(a) Current record counts:', before);

    // 安全检查：新数据的 branchId 不能撞上已有的加油站记录
    const clash = await Branch.find({ branchId: { $in: [...ids] }, type: { $ne: 'supermarket' } }).lean();
    if (clash.length > 0) {
        throw new Error(`branchId clash with non-supermarket records: ${clash.map(b => b.branchId).join(', ')}`);
    }

    // (b) 将删除的旧超市：只限 9 个旧 branchId，且不在新数据里
    const toDeleteIds = OLD_SEED_BRANCH_IDS.filter(id => !ids.has(id));
    const toDeleteExisting = await Branch.find({ branchId: { $in: toDeleteIds }, type: 'supermarket' }).lean();
    const overlapIds = OLD_SEED_BRANCH_IDS.filter(id => ids.has(id));
    console.log(`(b) Old seed supermarkets to delete (${toDeleteExisting.length} found in DB of ${toDeleteIds.length} candidates):`);
    toDeleteIds.forEach(id => {
        const found = toDeleteExisting.find(b => b.branchId === id);
        console.log(`  - ${id}${found ? `  (${found.name})` : '  (not in DB, nothing to delete)'}`);
    });
    if (overlapIds.length > 0) {
        console.log(`  Old branchIds also present in new data (will be overwritten by upsert, not deleted): ${overlapIds.join(', ')}`);
    }
    console.log('');

    // (c) 将写入的分店（数量取决于数据文件）
    const existingNew = new Set(
        (await Branch.find({ branchId: { $in: [...ids] } }, { branchId: 1 }).lean()).map(b => b.branchId)
    );
    console.log(`(c) Supermarkets to upsert (${docs.length}):`);
    docs.forEach(d => {
        const action = existingNew.has(d.branchId) ? 'update' : 'insert';
        const addr = d.address === MISSING_ADDRESS ? '  [no address]' : '';
        console.log(`  [${action}] ${d.chainId.padEnd(9)} ${d.name.padEnd(32)} (${d.latitude}, ${d.longitude})  ${d.branchId}${addr}`);
    });
    const missingAddr = docs.filter(d => d.address === MISSING_ADDRESS).length;
    console.log(`  ${missingAddr} records have no address; they will be stored as "${MISSING_ADDRESS}"`);
    console.log('');

    // (d) 不会触碰的集合
    console.log('(d) Will NOT touch: Chain, PriceSnapshot, ShoppingList, Branch records with type=fuel_station');
    console.log('');

    if (!isApply) {
        console.log('This is a dry-run; nothing was written.');
        console.log('Run again with --apply to write:');
        console.log('  node backend/scripts/updateBranches.js --apply');
        await mongoose.disconnect();
        return;
    }

    // === 写入：先 upsert，ordered 遇错即停；upsert 出错就不会走到删除这一步 ===
    const ops = docs.map(d => ({
        updateOne: {
            filter: { branchId: d.branchId, type: 'supermarket' },
            update: { $set: d },
            upsert: true
        }
    }));
    const upsertResult = await Branch.bulkWrite(ops, { ordered: true, runValidators: true });
    console.log(`Upserted: ${upsertResult.upsertedCount} inserted, ${upsertResult.modifiedCount} modified, ${upsertResult.matchedCount} matched`);

    const deleteResult = await Branch.deleteMany({ branchId: { $in: toDeleteIds }, type: 'supermarket' });
    console.log(`Deleted old seed supermarkets: ${deleteResult.deletedCount}\n`);

    // === 写完核对 ===
    const after = await countAll();
    printCounts('Record counts after apply:', after);

    const problems = [];
    if (after.fuelStations !== before.fuelStations) problems.push(`fuel_station count changed: ${before.fuelStations} -> ${after.fuelStations}`);
    if (after.priceSnapshots !== before.priceSnapshots) problems.push(`PriceSnapshot count changed: ${before.priceSnapshots} -> ${after.priceSnapshots}`);
    if (after.chains !== before.chains) problems.push(`Chain count changed: ${before.chains} -> ${after.chains}`);
    if (after.shoppingLists !== before.shoppingLists) problems.push(`ShoppingList count changed: ${before.shoppingLists} -> ${after.shoppingLists}`);
    const presentNew = await Branch.countDocuments({ branchId: { $in: [...ids] }, type: 'supermarket' });
    if (presentNew !== docs.length) problems.push(`expected ${docs.length} new supermarkets in DB, found ${presentNew}`);
    const leftoverOld = await Branch.countDocuments({ branchId: { $in: toDeleteIds } });
    if (leftoverOld !== 0) problems.push(`${leftoverOld} old seed branches still present`);

    if (problems.length > 0) {
        console.error('Verification FAILED:');
        problems.forEach(p => console.error(`  - ${p}`));
        await mongoose.disconnect();
        process.exit(1);
    }
    console.log('Verification passed: fuel stations, PriceSnapshot, Chain and ShoppingList counts unchanged; all new branches present; old seed branches removed.');

    await mongoose.disconnect();
}

main().catch(async err => {
    console.error('Update failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});

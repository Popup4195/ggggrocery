// Price Fetching Service
// Handles database queries for price matching between items and stores

const PriceSnapshot = require('../models/PriceSnapshot');
const { buildNameOrConditions, findCandidates, pickBestMatch } = require('./productNameMatch');

/**
 * Get prices for a list of items across multiple stores
 * @param {Array} items - [{ name: "Bread", quantity: 2 }, ...]
 * @param {Array} stores - ["paknsave", "newworld", ...]
 * @returns {Array} - [{ itemName, quantity, paknsave: {...}, newworld: {...} }, ...]
 *
 * 匹配逻辑（2024-XX 修复）：不再要求 item.name 跟数据库 productName 完全相等。
 * 爬虫数据里的 productName 是具体商品名（"vogel's bread 700g"），
 * 用户输入的是简单词（"bread"），只要数据库商品名"包含"用户输入词就算命中，
 * 命中多条时选该店最便宜的一条。详见 productNameMatch.js。
 */
async function getPricesForItems(items, stores) {
    if (!items || items.length === 0) return [];

    // 一次性预取所有"可能相关"的候选记录，避免对每个 item 都单独查一次库
    const orConditions = buildNameOrConditions(items.map(item => item.name));
    const priceDocs = orConditions.length > 0
        ? await PriceSnapshot.find({
            $or: orConditions,
            chainId: { $in: stores }
        }).lean()
        : [];

    // Assemble results
    const results = items.map(item => {
        const row = {
            itemName: item.name,
            quantity: item.quantity
        };

        let matchedAnywhere = false;

        stores.forEach(store => {
            const candidates = findCandidates(priceDocs, item.name, store);
            const best = pickBestMatch(candidates, item.name);

            if (best) {
                matchedAnywhere = true;
                row[store] = {
                    price: best.price,
                    unit: best.unit,
                    baseUnit: best.baseUnit,
                    unitPrice: best.unitPrice,
                    category: best.category,
                    // 新增：实际命中的库内商品名，方便前端展示"匹配到：Vogel's Bread"
                    // 以及排查匹配问题时一眼看出到底对上了哪条
                    matchedName: best.productName
                };
            } else {
                row[store] = null;
            }
        });

        // 全部超市都没匹配到，打个日志，别再悄无声息地丢商品了
        if (!matchedAnywhere) {
            console.warn(`[priceService] "${item.name}" 在所有选中超市都没有匹配到价格`);
        }

        return row;
    });

    return results;
}

/**
 * Get all known products with their base units (for frontend auto-complete)
 * @returns {Array} - [{ name: "bread", baseUnit: "loaf" }, ...]
 */
async function getAllProducts() {
    const products = await PriceSnapshot.aggregate([
        // Group by productName, take the first baseUnit/category encountered
        {
            $group: {
                _id: "$productName",
                baseUnit: { $first: "$baseUnit" },
                category: { $first: "$category" }
            }
        },
        // Rename _id to name for frontend compatibility
        {
            $project: {
                _id: 0,
                name: "$_id",
                baseUnit: 1,
                category: 1
            }
        }
    ]);

    return products;
}

module.exports = { getPricesForItems, getAllProducts };
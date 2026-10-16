// planRanking.js — 方案排序和分支定界初始上界（纯函数，方便测试）
//
// 背景：以前单店方案不管缺不缺商品都拿来当上界、最后也只按价格排序，
// 缺商品的单店方案因为"少买了东西"反而最便宜，被排成最佳，
// 还把能买全的多店方案在分支定界里剪掉了。

// 方案里"这家店没卖"的商品数。所有店都查不到价格的商品（globallyUnavailableItems）
// 对每个方案都一样，不算在内，否则单店方案和分支定界方案的口径不一致。
function countMissing(plan) {
    const global = new Set(plan.globallyUnavailableItems || []);
    return (plan.missingItems || []).filter(name => !global.has(name)).length;
}

// 先按缺失商品数升序，再按价格升序（驾车用 trueCost，步行用 groceryTotal）
function comparePlans(costKey) {
    return (a, b) => (countMissing(a) - countMissing(b)) || (a[costKey] - b[costKey]);
}

// 初始上界只取"覆盖全部可购买商品"的单店方案里最便宜的；一个都没有就不设上界
function initialUpperBound(singlePlans, availableItemCount) {
    let bound = Infinity;
    for (const plan of singlePlans) {
        const covered = (plan.breakdown || []).length;
        if (covered >= availableItemCount && plan.trueCost < bound) {
            bound = plan.trueCost;
        }
    }
    return bound;
}

module.exports = { countMissing, comparePlans, initialUpperBound };

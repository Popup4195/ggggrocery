// productNameMatch.js
// 商品名匹配的公共逻辑。
//
// 背景：切换成爬虫数据后，数据库里的 productName 变成了具体商品名
// （比如 "vogel's bread 700g"），但用户输入的还是简单词（比如 "bread"）。
// 原来的精确匹配（=== / $in）会导致这类查询全部落空。
// 这里改成"包含匹配"：只要库里的商品名包含用户输入的词，就算命中。
//
// 品类优先级：爬虫抓取时用了7个固定大类（见 scripts/scraper/runBatch.js /
// countdown-scraper/runBatchWoolworths.js），命中多条候选时先按品类筛一遍——
// 生鲜/肉类/烘焙这些"原型"品类优先于饮料/零食。
// 这是为了避免"某个饮料/零食恰好完全同名"抢走本该属于生鲜商品的匹配，
// 比如一款果汁产品的名字就直接是 "Peach"，如果只看"是否完全同名"，
// 会被误认成用户想买的桃子，导致比价用的是果汁的价格而不是桃子的价格。
const CATEGORY_PRIORITY = [
    'Fruit & Vegetables',
    'Meat, Poultry & Seafood',
    'Fridge, Deli & Eggs',
    'Bakery',
    'Frozen',
    'Pantry',
    'Hot & Cold Drinks'
];

function categoryRank(category) {
    const idx = CATEGORY_PRIORITY.indexOf(category);
    return idx === -1 ? CATEGORY_PRIORITY.length : idx; // 没识别出品类的排最后
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成一批 $or 条件，用于一次性从数据库里预取所有"可能相关"的候选记录。
 * 真正精确判断"到底算不算命中"在 findCandidates 里做（避免 $regex 的边界情况在数据库层出错）。
 */
function buildNameOrConditions(userInputNames) {
    return userInputNames
        .filter(name => name && name.trim())
        .map(name => ({
            productName: { $regex: escapeRegex(name.toLowerCase().trim()), $options: 'i' }
        }));
}

/**
 * 从预取的候选文档里，筛出真正"包含"用户输入词、且属于指定 chain 的那些。
 */
function findCandidates(docs, userInputName, chainId) {
    const needle = userInputName.toLowerCase().trim();
    if (!needle) return [];
    return docs.filter(doc => doc.chainId === chainId && doc.productName.includes(needle));
}

/**
 * 从候选里选一条最合适的：
 *  1. 先按品类优先级筛出"最靠谱"的那一档候选（生鲜/肉类/烘焙优先于饮料/零食）
 *  2. 同品类里，有完全同名的（比如库里刚好也留了一条老数据叫 "bread"）优先用它
 *  3. 否则选同品类里单价（unitPrice，没有就退回 price）最低的一条——
 *     用户说"面包"，店里有好几种面包，报最便宜那款的价格才符合"比价"这个产品的初衷
 */
function pickBestMatch(candidates, userInputName) {
    if (!candidates || candidates.length === 0) return null;

    const needle = userInputName.toLowerCase().trim();

    const bestRank = Math.min(...candidates.map(d => categoryRank(d.category)));
    const topCategoryCandidates = candidates.filter(d => categoryRank(d.category) === bestRank);

    const exact = topCategoryCandidates.find(d => d.productName === needle);
    if (exact) return exact;

    return topCategoryCandidates.reduce((min, d) => {
        const dPrice = d.unitPrice ?? d.price ?? Infinity;
        const minPrice = min.unitPrice ?? min.price ?? Infinity;
        return dPrice < minPrice ? d : min;
    });
}

module.exports = { escapeRegex, buildNameOrConditions, findCandidates, pickBestMatch };
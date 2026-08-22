// productNameMatch.js
// 商品名匹配的公共逻辑。
//
// 背景：切换成爬虫数据后，数据库里的 productName 变成了具体商品名
// （比如 "vogel's bread 700g"），但用户输入的还是简单词（比如 "bread"）。
// 原来的精确匹配（=== / $in）会导致这类查询全部落空。
// 这里改成"包含匹配"：只要库里的商品名包含用户输入的词，就算命中。
//
// 相关度排序：不再只按品类优先级选。老逻辑的一个明显缺陷是——
// "cheese" 会被生鲜品类里一款 "pineapple & cheese 水果零食" 抢走
// （生鲜排第一、又按最便宜选），"milk" 会命中 "coconut milk"/"milk powder"。
// 现在改成：先按"词在商品名里的位置"打分，再比品类。
//   完全同名 > 通用名(带包装规格，如 "milk 2l") > 首词命中 > 尾词命中 > 中间任意词命中。
// 这样 "cheese slices" 会排在 "pineapple & cheese" 前面，"milk 2l" 会排在
// "coconut milk" 前面。
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

// 单复数变形（跟前端 App.jsx 里的 pluralOf/wordMatchesInput 保持一致），
// 用于整词匹配时允许 "banana" 对上 "bananas" 这种情况。
// 额外补了 "y -> ies" 规则（berry -> berries），避免 "berry" 对不上 "berries"。
function pluralOf(word) {
    if (/(ch|sh|[sxz])$/.test(word)) return word + 'es';
    if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
    return word + 's';
}

// 英式/美式拼写变体。新西兰的 Woolworths 数据里写的是 "yoghurt"（英式），
// 但用户（尤其习惯美式拼写的）可能输入 "yogurt"，两者应视为同一个词。
const VARIANT_MAP = {
    yogurt: ['yoghurt'],
    yoghurt: ['yogurt'],
    flavour: ['flavor'],
    flavor: ['flavour'],
    colour: ['color'],
    color: ['colour']
};

// 判断商品名里的某个词，是否跟用户输入词能对上（整词，允许单复数互换）。
function wordMatchesInput(word, needle) {
    if (word === needle) return true;
    if (pluralOf(needle) === word) return true;
    if (pluralOf(word) === needle) return true;
    const variants = VARIANT_MAP[needle];
    if (variants && variants.includes(word)) return true;
    return false;
}


/**
 * 生成一批 $or 条件，用于一次性从数据库里预取所有"可能相关"的候选记录。
 * 真正精确判断"到底算不算命中"在 findCandidates 里做（避免 $regex 的边界情况在数据库层出错）。
 *
 * 会为输入词扩展拼写变体：用户输 "yogurt" 但库里是英式 "yoghurt" 时，
 * 若只按原文生成 regex 会在数据库查询层就漏掉全部候选。
 */
function buildNameOrConditions(userInputNames) {
    const conditions = [];
    for (const name of userInputNames) {
        const base = name.toLowerCase().trim();
        if (!base) continue;
        conditions.push({
            productName: { $regex: escapeRegex(base), $options: 'i' }
        });
        // 变体词也生成 regex：用户输 "yogurt" 但库里是英式 "yoghurt" 时，
        // 数据库查询层就能直接查到候选（findCandidates 的 wordMatchesInput
        // 在打分/筛选时也会用 VARIANT_MAP 兜底）。
        const variants = VARIANT_MAP[base];
        if (variants) {
            for (const v of variants) {
                conditions.push({
                    productName: { $regex: escapeRegex(v), $options: 'i' }
                });
            }
        }
    }
    return conditions;
}



/**
 * 从预取的候选文档里，筛出真正"包含"用户输入词、且属于指定 chain 的那些。
 *
 * 改成整词匹配（而不是裸子串 includes）：以前 "bread" 会误伤 "shortbread biscuit"，
 * "ban" 会误伤 "banana slab cake"，因为子串匹配不管这个词是不是独立单词。
 * 现在要求 productName 分词后，至少有一个词能跟 userInputName 整词对上
 * （允许单复数互换），完全同名（比如用户直接打了完整具体商品名）依然保留兜底判断。
 */
function findCandidates(docs, userInputName, chainId) {
    const needle = userInputName.toLowerCase().trim();
    if (!needle) return [];
    return docs.filter(doc => {
        if (doc.chainId !== chainId) return false;
        const lowerName = doc.productName.toLowerCase();
        if (lowerName === needle) return true;
        if (lowerName.includes(needle) && needle.split(/\s+/).length > 1) {
            // 用户输入是多个词（比如从下拉框选中后又手动改过的具体商品名），
            // 多词短语按原来的子串匹配处理，不做整词切分，避免误伤长商品名的判断变复杂。
            return true;
        }
        const words = lowerName.split(/\s+/);
        return words.some(w => wordMatchesInput(w, needle));
    });
}

/**
 * 过滤价格异常值。
 * 爬虫偶尔会把总价/整包价当成单价存进 unitPrice（比如 baby leaf lettuce @429、
 * campari vine tomatoes @77.67），这种错值会污染"选最便宜"的逻辑，
 * 让荒谬商品在比价里胜出。这里用"相对中位数"做判断：候选样本够多（≥4）时，
 * 把单价超过中位数 8 倍（明显是数量级错误）的候选剔掉。
 * 样本太少时不判断，避免误伤正常的高单价商品（如高档海鲜）。
 */
function filterOutlierPrices(candidates) {
    const prices = candidates
        .map(d => d.unitPrice ?? d.price)
        .filter(p => typeof p === 'number' && Number.isFinite(p) && p > 0);
    if (prices.length < 4) return candidates;

    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    return candidates.filter(d => {
        const p = d.unitPrice ?? d.price;
        if (p == null || !Number.isFinite(p) || p <= 0) return true; // 没价格的不参与，留着也不影响
        return p <= median * 8;
    });
}

// 包装规格正则：跟在商品通用名后面的一串数字+单位（milk 2l / eggs 12 pack / bread 700g）
const PACK_RE = /^\s*\d+(\.\d+)?\s*(kg|g|ml|l|pk|pack|packet|bottle|bag|loaf|carton|tray|dozen|ea)?\s*$/i;

// 新西兰超市常见自有/常见品牌词。品牌名后面紧跟目标词时（anchor butter、
// woolworths cheese cheddar），目标词几乎可以肯定是"这个东西本身"，
// 而不是"XX 味的别的东西"（butter croissant / sausages cheese cocktail）。
const BRAND_WORDS = new Set([
    'woolworths', 'anchor', 'pams', 'essentials', 'everyday', 'fresha',
    'homebrand', 'value', 'tip', 'top', 'arnotts', 'griffins', 'cadbury',
    'whittakers', 'mrs', 'mac', 'olmec', 'ferrero', 'lindt'
]);

// 常见食品主体名词。当目标词后面紧跟着这些词时，说明目标词大概率只是
// 修饰成分、真正的商品主体是后面那个词（比如 "milk compound chocolate
// buttons" —— milk 修饰 chocolate，不是卖牛奶）。这个黑名单只在"目标词
// 不是完全同名/通用名"时用来做惩罚，不会误伤 "anchor butter" 这种。
const FOOD_SUBJECT_WORDS = new Set([
    'chocolate', 'chips', 'biscuit', 'biscuits', 'cookies', 'cake', 'cakes',
    'roll', 'rolls', 'bread', 'loaf', 'croissant', 'croissants', 'muffin',
    'muffins', 'sausages', 'sausage', 'nibbles', 'tenders', 'wings', 'drumsticks',
    'patties', 'burger', 'burgers', 'pie', 'pies', 'sauce', 'sauces', 'syrup',
    'yoghurt', 'yogurt', 'ice', 'cream', 'powder', 'paste', 'base', 'mix',
    'snack', 'snacks', 'bar', 'bars', 'cereal', 'spread', 'seasoning', 'stock',
    'soup', 'pasta', 'noodles', 'rice', 'granola', 'crackers', 'pretzels'
]);


/**
 * 判断"商品名本身就是这个商品的通用名"。
 * "milk"、"milk 2l"、"eggs 12 pack" 这类 → true；
 * "coconut milk"、"milk powder"、"milkshake" → false（前者不是牛奶本身，
 * 后者只是以 milk 开头的其他东西）。
 */
function isGenericName(lowerName, needle) {
    if (lowerName === needle || lowerName === pluralOf(needle)) return true;
    if (lowerName.startsWith(needle)) {
        return PACK_RE.test(lowerName.slice(needle.length));
    }
    return false;
}

/**
 * 匹配相关度打分（分数越低越相关）：
 *  0 完全同名
 *  1 通用名（带包装规格，如 "milk 2l"）
 *  2 品牌名 + 目标词（anchor butter / woolworths cheese cheddar），
 *    或者首词直接命中（bread kind gluten free loaf）
 *  3 尾词命中（pams garlic bread / bagels cheese）
 *  4 中间靠前命中（第 3~4 个词，如 fresh fruit bananas yellow loose）
 *  5 更靠后的中间词命中（yoplait yoghurt tub peach & mango）
 *  6 多词输入的纯子串命中
 *  7 兜底
 *
 * 关键洞察（来自真实数据排查）：
 *  - "cheese" 候选里既有 "woolworths cheese cheddar everyday block"（真奶酪），
 *    也有 "woolworths sausages cheese cocktail"（奶酪味香肠），两者都是中间词，
 *    单靠词位置分不出；品牌名后面紧跟目标词的，几乎肯定是主体，给最高分。
 *  - "butter" 候选里 "butter croissant"/"butter chicken" 这类以 butter 开头的
 *    反而是"黄油味的别的东西"，所以首词命中不能排在最前——品牌+目标词
 *    模式（anchor butter）更可靠。
 *  - 尾词命中（milk 结尾的 coconut milk / bagels 结尾的 cheese）通常是修饰成分。
 */
function matchScore(lowerName, needle) {
    if (lowerName === needle) return 0;
    if (isGenericName(lowerName, needle)) return 1;
    const words = lowerName.split(/\s+/);
    const idx = words.findIndex(w => wordMatchesInput(w, needle));
    if (idx === -1) return lowerName.includes(needle) ? 6 : 7;

    let score;
    if (idx === 1 && BRAND_WORDS.has(words[0])) score = 2;       // 品牌+目标词
    else if (idx === 0) score = 2;                                // 首词命中
    else if (idx === words.length - 1) score = 3;                 // 尾词命中
    else if (idx <= 3) score = 4;                                 // 第 3~4 个词
    else score = 5;                                               // 更靠后

    // 目标词后面很近（1~2 个词内）跟着另一个食品主体名词时，说明目标词
    // 只是修饰成分、商品主体是后面那个词：
    //   "pams milk compound chocolate buttons" → milk 修饰 chocolate
    //   "cheese long rolls"                     → cheese 修饰 rolls
    //   "butter croissant"                      → butter 修饰 croissant
    // 加 +3 惩罚，让真正以目标词为主体的候选胜出。
    // 注意惩罚窗口只取紧邻的 1~2 个词，避免误伤 "bread kind gluten free loaf
    // everyday"（loaf 在目标词 4 个词之外，bread 本身就是主体）。
    const nextTwo = words.slice(idx + 1, idx + 3);
    if (nextTwo.some(w => FOOD_SUBJECT_WORDS.has(w))) return score + 3;

    return score;
}



/**
 * 从候选里选一条最合适的：
 *  0. 如果调用方传了 preferredCategory（用户在下拉框选中商品时的具体品类，
 *     比如气泡水属于 "Hot & Cold Drinks"、脆皮面包属于 "Pantry"），
 *     就【只在这个品类里挑】，不再套用下面写死的品类优先级顺序，
 *     也【不允许跨品类兜底】——如果这家店在这个品类里压根没有能匹配上
 *     这个词的商品，直接返回 null（表示这家店没有），而不是退而求其次
 *     选一个完全不相关品类的商品（比如硬塞一个桃子酸奶给"桃子味气泡水"）。
 *  0.5 如果同时传了 preferredExactName（用户选中的那个具体商品全名），
 *     且该店里恰好有完全同名的商品，直接选它（"一模一样"最高优先）。
 *  1. 没有传 preferredCategory 时（比如商品是手动打字、没从下拉框选过），
 *     先按匹配相关度打分（完全同名 > 通用名 > 首词 > 尾词 > 中间词），
 *     再在同等相关度里按品类优先级筛，最后选名字最短（最接近"这个东西本身"）
 *     且单价最低的一条。
 *  2. 在选之前，先过滤掉单价异常值（爬虫错把总价当单价的情况）。
 */
function pickBestMatch(candidates, userInputName, preferredCategory, preferredExactName) {
    if (!candidates || candidates.length === 0) return null;

    const needle = userInputName.toLowerCase().trim();

    // 先过滤价格异常值（比如 429 这种爬虫错值）
    let pool = filterOutlierPrices(candidates);
    if (pool.length === 0) pool = candidates; // 万一全被过滤，退回用原始候选

    if (preferredCategory) {
        // 严格限制：只在同品类里找，找不到就直接没有，不跨品类兜底
        pool = pool.filter(d => d.category === preferredCategory);
        if (pool.length === 0) return null;

        // "一模一样"优先：该店里如果恰好有完全同名的具体商品，直接选它
        if (preferredExactName) {
            const exactConfirmed = pool.find(d => d.productName === preferredExactName.toLowerCase().trim());
            if (exactConfirmed) return exactConfirmed;
        }

        const exact = pool.find(d => d.productName === needle);
        if (exact) return exact;

        return pool.reduce((min, d) => {
            const dPrice = d.unitPrice ?? d.price ?? Infinity;
            const minPrice = min.unitPrice ?? min.price ?? Infinity;
            return dPrice < minPrice ? d : min;
        });
    }

    // 未确认商品：先按相关度打分，取分数最低的那一档，再比品类、名称长度、价格
    const scored = pool.map(d => ({ d, score: matchScore(d.productName.toLowerCase(), needle) }));
    const bestScore = Math.min(...scored.map(s => s.score));
    let tier = scored.filter(s => s.score === bestScore).map(s => s.d);

    const bestRank = Math.min(...tier.map(d => categoryRank(d.category)));
    tier = tier.filter(d => categoryRank(d.category) === bestRank);

    const exact = tier.find(d => d.productName === needle);
    if (exact) return exact;

    // 名称越短越接近"这个东西本身"（milk 2l < coconut milk 3l），同长再比价
    tier.sort((a, b) => {
        const lenDiff = a.productName.length - b.productName.length;
        if (lenDiff !== 0) return lenDiff;
        return (a.unitPrice ?? a.price ?? Infinity) - (b.unitPrice ?? b.price ?? Infinity);
    });
    return tier[0];
}

module.exports = { escapeRegex, buildNameOrConditions, findCandidates, pickBestMatch };

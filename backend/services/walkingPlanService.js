// walkingPlanService.js — FR07 步行/公共交通模式
// this is for users without a car, no fuel cost needed
// 算法比分支定界简单多了，不用算油费
// 1. 找各品牌最近的分店
// 2. 扔掉太远的（默认 2km 以内）
// 3. 查价格，算总价
// 4. 按总价从低到高排序
// 5. 支持一站式 + 两店方案（最多 2 家，走太多家提不动菜）

const Branch = require('../models/Branch');
const PriceSnapshot = require('../models/PriceSnapshot');
const { getDistances } = require('./distanceService');
// 复用 planService.js 也在用的同一套匹配逻辑（整词匹配 + 品类优先级 +
// "一模一样优先"），而不是之前那种精确匹配（$in），否则用户打的宽松词
// （比如 "bread"）在这里永远查不到东西，因为库里存的是具体商品名
// （比如 "Vogel's Bread 700g"），根本不会完全相等。
const { buildNameOrConditions, findCandidates, pickBestMatch } = require('./productNameMatch');

// 默认步行上限（公里），用户可以在 slider 里调
const DEFAULT_WALKING_MAX_KM = 2.0;
// 平均步行速度，用来估算步行时间
const WALKING_SPEED_KMH = 5;

// ================================================================
// HELPER: estimate walking time in minutes
// 距离 (km) / 速度 (km/h) * 60
// ================================================================
function estimateWalkingTime(distanceKm) {
    return Math.round((distanceKm / WALKING_SPEED_KMH) * 60);
}

// ================================================================
// 主函数: generate walking shopping plans
//
// 参数:
//   items: [{ name, quantity }]
//   supermarkets: [chainId, ...]
//   userLat, userLng: 用户坐标
//   walkingMaxKm: 步行上限，默认 2km
// ================================================================
async function generateWalkingPlans({ items, supermarkets, userLat, userLng, walkingMaxKm }) {
    const maxKm = walkingMaxKm || DEFAULT_WALKING_MAX_KM;

    // ==================== PHASE 1: 找步行可达的分店 ====================

    // 对每个选中品牌，找最近的分店 + 算距离
    const reachableBranches = {};  // chainId -> { branchInfo, distance }

    for (const chainId of supermarkets) {
        const branches = await Branch.find({
            chainId: chainId,
            type: 'supermarket',
            isActive: true
        });

        if (branches.length === 0) continue;

        // 算用户到每个分店的距离，直接用 distanceService 的 haversine
        const distances = await getDistances(
            userLat,
            userLng,
            branches.map(b => ({
                branchId: b.branchId,
                latitude: b.latitude,
                longitude: b.longitude
            }))
        );

        // 找距离最近的那个分店
        let minDist = Infinity;
        let closestBranch = null;

        distances.forEach(d => {
            if (d.distanceKm < minDist) {
                const branch = branches.find(b => b.branchId === d.branchId);
                if (branch) {
                    minDist = d.distanceKm;
                    closestBranch = branch;
                }
            }
        });

        // 只有步行范围内的才保留，太远的直接扔掉
        if (closestBranch && minDist <= maxKm) {
            reachableBranches[chainId] = {
                branchId: closestBranch.branchId,
                branchName: closestBranch.name,
                chainId: chainId,
                address: closestBranch.address,
                latitude: closestBranch.latitude,
                longitude: closestBranch.longitude,
                distance: Math.round(minDist * 100) / 100
            };
        }
    }

    // 如果一家步行可达的超市都没有，给用户一个友好的提示
    const availableChains = Object.keys(reachableBranches);
    if (availableChains.length === 0) {
        return {
            plans: [],
            message: `No supermarket is within ${maxKm} km walking distance from your location. Try increasing the distance limit or consider driving.`,
            globallyUnavailableItems: []
        };
    }

    // ==================== PHASE 2: 预加载价格 ====================

    // 先建个空的 priceMap，省得后面反复查数据库
    const priceMap = {};
    const matchedNameMap = {}; // 跟 planService.js 一样，记录每个 (chain, 用户输入名) 实际匹配到的库内商品名
    const imageUrlMap = {};    // 同理，记录实际命中商品的图片
    for (const chainId of availableChains) {
        priceMap[chainId] = {};
        matchedNameMap[chainId] = {};
        imageUrlMap[chainId] = {};
    }

    // 一次性预取所有"可能相关"的候选记录（宽松的 $or regex，不是精确匹配），
    // 真正判断"算不算命中"交给 findCandidates 做整词匹配。
    const orConditions = buildNameOrConditions(items.map(item => item.name));
    const priceDocs = orConditions.length > 0
        ? await PriceSnapshot.find({
            $or: orConditions,
            chainId: { $in: availableChains }
        }).lean()
        : [];

    for (const chainId of availableChains) {
        for (const item of items) {
            const name = item.name.toLowerCase().trim();
            const candidates = findCandidates(priceDocs, item.name, chainId);
            const best = pickBestMatch(candidates, item.name, item.category, item.confirmedName);
            if (best && best.unitPrice !== null) {
                priceMap[chainId][name] = best.unitPrice;
                matchedNameMap[chainId][name] = best.productName;
                imageUrlMap[chainId][name] = best.imageUrl || null;
            }
        }
    }

    // ==================== PHASE 2.5: 找在所有步行可达超市都完全没匹配到价格的商品 ====================
    // 跟 planService.js 的 unavailableItems 逻辑一致：这些商品哪怕换个店铺组合
    // 也不可能出现在任何步行方案里，需要单独报告给调用方，而不是让它们在
    // breakdown 里悄悄消失。

    const unavailableItems = [];
    for (const item of items) {
        const name = item.name.toLowerCase().trim();
        const foundAnywhere = availableChains.some(chainId => {
            const price = priceMap[chainId]?.[name];
            return price !== undefined && price !== null;
        });
        if (!foundAnywhere) unavailableItems.push(item.name);
    }

    // ==================== PHASE 3: 生成方案 ====================

    const allPlans = [];
    const plansSet = new Set();  // dedup，防止重复方案

    // ---- PLAN TYPE A: 一站式方案（全部在一家店买） ----
    for (const chainId of availableChains) {
        const branchInfo = reachableBranches[chainId];
        let groceryTotal = 0;
        let hasMissing = false;
        const breakdown = [];
        const missingAtThisStore = []; // 这家店没卖的商品（包括全局都没有的）

        for (const item of items) {
            const name = item.name.toLowerCase();
            const unitPrice = priceMap[chainId]?.[name];

            if (unitPrice !== undefined && unitPrice !== null) {
                const total = Math.round(unitPrice * item.quantity * 100) / 100;
                groceryTotal += total;
                breakdown.push({
                    name: item.name,
                    quantity: item.quantity,
                    unitPrice: unitPrice,
                    total: total,
                    store: chainId,
                    matchedName: matchedNameMap[chainId]?.[name] || null,
                    imageUrl: imageUrlMap[chainId]?.[name] || null
                });
            } else {
                hasMissing = true;  // 查不到价格，标记一下
                missingAtThisStore.push(item.name);
            }
        }

        groceryTotal = Math.round(groceryTotal * 100) / 100;

        // 一件商品都没匹配到的店，不能算一个有效的方案——
        // 跟 planService.js 里同样的修复，避免"买了 0 件东西"却因为
        // $0 最便宜被排到推荐列表最前面。
        if (breakdown.length === 0) {
            continue;
        }

        // 步行距离: 家 → 店 → 家（往返）
        const roundTripKm = Math.round(branchInfo.distance * 2 * 100) / 100;
        const walkingTime = estimateWalkingTime(branchInfo.distance); // 单程时间，不是往返

        const planKey = `single-${chainId}-${groceryTotal.toFixed(2)}`;
        if (!plansSet.has(planKey)) {
            plansSet.add(planKey);
            allPlans.push({
                strategy: 'single',
                transportMode: 'walking',
                groceryTotal: groceryTotal,
                // 步行没有 fuel cost，所以 trueCost = groceryTotal
                trueCost: groceryTotal,
                stores: [{
                    chainId: chainId,
                    branchId: branchInfo.branchId,
                    branchName: branchInfo.branchName,
                    address: branchInfo.address,
                    distance: branchInfo.distance,
                    walkingTimeMin: walkingTime
                }],
                walkingDistance: branchInfo.distance,
                roundTripWalkingKm: roundTripKm,
                roundTripWalkingTimeMin: estimateWalkingTime(roundTripKm),
                hasMissingPrice: hasMissing,
                missingItems: missingAtThisStore,
                globallyUnavailableItems: unavailableItems,
                breakdown: breakdown,
                storeCount: 1
            });
        }
    }

    // ---- PLAN TYPE B: 两店方案 ----
    // only available if at least 2 chains are reachable
    // 逻辑: A 店买一部分，B 店买另一部分，按价格差分配
    // 这样用户可以去两家比较近的店分别买不同的东西
    if (availableChains.length >= 2 && items.length >= 2) {
        for (let i = 0; i < availableChains.length; i++) {
            for (let j = i + 1; j < availableChains.length; j++) {
                const chainA = availableChains[i];
                const chainB = availableChains[j];
                const branchA = reachableBranches[chainA];
                const branchB = reachableBranches[chainB];

                // 两店都要在步行范围内
                // 不试所有排列组合，只试一种合理的分配:
                //   - 差价大的商品去便宜的店买
                //   - 差价小的留在另一家

                // 先算每个商品在 A 和 B 的差价
                const priceDiffs = [];
                for (const item of items) {
                    const name = item.name.toLowerCase();
                    const priceA = priceMap[chainA]?.[name];
                    const priceB = priceMap[chainB]?.[name];

                    if (priceA !== undefined && priceA !== null && priceB !== undefined && priceB !== null) {
                        priceDiffs.push({
                            name: item.name,
                            quantity: item.quantity,
                            priceA: priceA,
                            priceB: priceB,
                            diff: priceA - priceB // 正数 = B 比较便宜
                        });
                    }
                }

                // 如果有些商品两家都没有，直接跳过这个组合
                if (priceDiffs.length === 0) continue;

                // 按差价排序: B 比 A 便宜最多的排最前面
                // 前半去 B 买，后半留 A 买
                priceDiffs.sort((a, b) => b.diff - a.diff);

                const splitPoint = Math.ceil(priceDiffs.length / 2);
                const itemsInB = priceDiffs.slice(0, splitPoint);
                const itemsInA = priceDiffs.slice(splitPoint);

                // 算两家店各自的杂货总价
                let totalA = 0;
                let totalB = 0;
                const breakdownA = [];
                const breakdownB = [];

                for (const item of itemsInA) {
                    const total = Math.round(item.priceA * item.quantity * 100) / 100;
                    totalA += total;
                    breakdownA.push({
                        name: item.name,
                        quantity: item.quantity,
                        unitPrice: item.priceA,
                        total: total,
                        store: chainA,
                        matchedName: matchedNameMap[chainA]?.[item.name.toLowerCase()] || null,
                        imageUrl: imageUrlMap[chainA]?.[item.name.toLowerCase()] || null
                    });
                }

                for (const item of itemsInB) {
                    const total = Math.round(item.priceB * item.quantity * 100) / 100;
                    totalB += total;
                    breakdownB.push({
                        name: item.name,
                        quantity: item.quantity,
                        unitPrice: item.priceB,
                        total: total,
                        store: chainB,
                        matchedName: matchedNameMap[chainB]?.[item.name.toLowerCase()] || null,
                        imageUrl: imageUrlMap[chainB]?.[item.name.toLowerCase()] || null
                    });
                }

                const groceryTotal = Math.round((totalA + totalB) * 100) / 100;

                // 只有两家店都能查到价格的商品才会进 priceDiffs → itemsInA/itemsInB
                // （见上面的过滤），只在其中一家有价格的商品会被漏掉——这里补上，
                // 免得它们在这个双店方案的 breakdown 里悄悄消失。
                const includedNames = new Set(
                    [...itemsInA, ...itemsInB].map(i => i.name.toLowerCase())
                );
                const missingAtThisSplit = items
                    .filter(item => !includedNames.has(item.name.toLowerCase()))
                    .map(item => item.name);

                // 步行路线: 家 → 近的那个 → 远的那个 → 家
                // 按距离排序，先近后远
                let routeDistance;
                let store1, store2;
                if (branchA.distance <= branchB.distance) {
                    // route: home → A → B → home
                    const distAtoB = Math.sqrt(
                        Math.pow((branchA.latitude - branchB.latitude) * 111, 2) +
                        Math.pow((branchA.longitude - branchB.longitude) * 111 * Math.cos((branchA.latitude + branchB.latitude) / 2 * Math.PI / 180), 2)
                    );
                    routeDistance = Math.round((branchA.distance + distAtoB + branchB.distance) * 100) / 100;
                    store1 = {
                        chainId: chainA,
                        branchId: branchA.branchId,
                        branchName: branchA.branchName,
                        address: branchA.address,
                        distance: branchA.distance,
                        walkingTimeMin: estimateWalkingTime(branchA.distance),
                        items: itemsInA.map(i => ({ name: i.name, quantity: i.quantity }))
                    };
                    store2 = {
                        chainId: chainB,
                        branchId: branchB.branchId,
                        branchName: branchB.branchName,
                        address: branchB.address,
                        distance: branchB.distance,
                        walkingTimeMin: estimateWalkingTime(branchB.distance),
                        items: itemsInB.map(i => ({ name: i.name, quantity: i.quantity }))
                    };
                } else {
                    // route: home → B → A → home
                    const distBtoA = Math.sqrt(
                        Math.pow((branchB.latitude - branchA.latitude) * 111, 2) +
                        Math.pow((branchB.longitude - branchA.longitude) * 111 * Math.cos((branchB.latitude + branchA.latitude) / 2 * Math.PI / 180), 2)
                    );
                    routeDistance = Math.round((branchB.distance + distBtoA + branchA.distance) * 100) / 100;
                    store1 = {
                        chainId: chainB,
                        branchId: branchB.branchId,
                        branchName: branchB.branchName,
                        address: branchB.address,
                        distance: branchB.distance,
                        walkingTimeMin: estimateWalkingTime(branchB.distance),
                        items: itemsInB.map(i => ({ name: i.name, quantity: i.quantity }))
                    };
                    store2 = {
                        chainId: chainA,
                        branchId: branchA.branchId,
                        branchName: branchA.branchName,
                        address: branchA.address,
                        distance: branchA.distance,
                        walkingTimeMin: estimateWalkingTime(branchA.distance),
                        items: itemsInA.map(i => ({ name: i.name, quantity: i.quantity }))
                    };
                }

                const planKey = `split-${chainA}-${chainB}-${groceryTotal.toFixed(2)}`;
                if (!plansSet.has(planKey)) {
                    plansSet.add(planKey);
                    allPlans.push({
                        strategy: 'split',
                        transportMode: 'walking',
                        groceryTotal: groceryTotal,
                        trueCost: groceryTotal,
                        stores: [store1, store2],
                        walkingDistance: routeDistance,
                        roundTripWalkingKm: routeDistance,
                        roundTripWalkingTimeMin: estimateWalkingTime(routeDistance),
                        hasMissingPrice: missingAtThisSplit.length > 0,
                        missingItems: missingAtThisSplit,
                        globallyUnavailableItems: unavailableItems,
                        breakdown: [...breakdownA, ...breakdownB],
                        storeCount: 2
                    });
                }
            }
        }
    }

    // ==================== PHASE 4: 排序 + 返回 ====================

    // 按总价从低到高排
    allPlans.sort((a, b) => a.groceryTotal - b.groceryTotal);

    // 去重，一样的方案只保留一个（相同 strategy + chain 组合 + 总价）
    const uniquePlans = [];
    const seenKeys = new Set();
    for (const plan of allPlans) {
        const key = `${plan.strategy}-${plan.stores.map(s => s.chainId).sort().join(',')}-${plan.groceryTotal.toFixed(2)}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniquePlans.push(plan);
        }
    }

    // 分配排名，从 1 开始
    uniquePlans.forEach((plan, index) => {
        plan.rank = index + 1;
    });

    return {
        plans: uniquePlans.slice(0, 10), // 最多返回 10 个方案
        message: null,
        // 在所有步行可达超市都完全查不到价格的商品（所有方案通用）
        globallyUnavailableItems: unavailableItems
    };
}

module.exports = { generateWalkingPlans };


// planService.js — 这就是 fr07 的 Plan Generation 引擎，整个 app 的大脑
// 用分支定界(branch and bound)算法来找最优购物方案
// 分支定界说白了就是比穷举聪明一点，把那些不可能比当前最优方案更好的分支直接砍掉
// 省得浪费时间算那些没用的组合
//
// 我们会生成这几种方案:
// 1. single store — 全部在一家超市买齐
// 2. split — 分几家买，A 超市买一些，B 超市买一些（可以是 2 或 3 家）
// 3. 到处买 — 其实 split 已经覆盖了这种情况
//
// 核心思路: 分支定界让我们可以探索所有可能性，
// 但一旦某个分支已经比已知最优方案更差了就直接跳过，不往下走了

const Branch = require('../models/Branch');
const PriceSnapshot = require('../models/PriceSnapshot');
const { getDistances } = require('./distanceService');
const { getGroceryTotal } = require('./trueCostService');

// 默认值，跟 fr17 保持一致
const DEFAULT_FUEL_EFFICIENCY = 10; // km/L, 新西兰平均油耗
const DEFAULT_FUEL_PRICE = 2.80;    // 如果数据库里没加油站数据就默认 $2.80/L

// ================================================================
// HELPER 1: 找每个超市连锁离用户最近的分店
// 同一品牌在不同分店的价格是一样的
// 所以我们选最近的那家，省得开车跑远路
// ================================================================
async function findNearestBranches(supermarkets, userLat, userLng) {
    // supermarkets 就是用户选的品牌列表，比如 ['paknsave', 'newworld', 'countdown']
    const nearestBranches = {};

    for (const chainId of supermarkets) {
        const branches = await Branch.find({
            chainId: chainId,
            type: 'supermarket',
            isActive: true
        });

        if (branches.length === 0) continue;

        // 算用户到该品牌每个分店的距离

        const distances = await getDistances(
            userLat,
            userLng,
            branches.map(b => ({
                branchId: b.branchId,
                latitude: b.latitude,
                longitude: b.longitude
            }))
        );

        // 找距离最近的那家

        let minDist = Infinity;
        let closestBranch = null;
        distances.forEach(d => {
            if (d.distanceKm < minDist) {
                minDist = d.distanceKm;
                const branch = branches.find(b => b.branchId === d.branchId);
                if (branch) closestBranch = branch;
            }
        });

        if (closestBranch) {
            nearestBranches[chainId] = {
                branchId: closestBranch.branchId,
                branchName: closestBranch.name,
                chainId: chainId,
                address: closestBranch.address,
                latitude: closestBranch.latitude,
                longitude: closestBranch.longitude,
                distance: minDist
            };
        }
    }

    return nearestBranches;
}

// ================================================================
// HELPER 2: 找离用户最近的加油站
// 我们自动推荐最近的加油站，用户不用自己选
// 返回这个站的油价（按用户选的油种：91/95/diesel）
// ================================================================
async function findBestFuelStation(userLat, userLng, fuelType) {

    const fuelStations = await Branch.find({
        type: 'fuel_station',
        isActive: true
    });

    if (fuelStations.length === 0) {
    // 数据库里没有加油站数据，用默认油价

        return {
            branchId: null,
            name: 'Default',
            fuelPrice: DEFAULT_FUEL_PRICE,
            distance: 0
        };
    }

    // get distances to all fuel stations
    const distances = await getDistances(
        userLat,
        userLng,
        fuelStations.map(b => ({
            branchId: b.branchId,
            latitude: b.latitude,
            longitude: b.longitude
        }))
    );

    // find the closest one
    let minDist = Infinity;
    let bestStation = null;

    distances.forEach(d => {
        if (d.distanceKm < minDist) {
            minDist = d.distanceKm;
            const station = fuelStations.find(s => s.branchId === d.branchId);
            if (station) bestStation = station;
        }
    });

    if (!bestStation) {
        return {
            branchId: null,
            name: 'Default',
            fuelPrice: DEFAULT_FUEL_PRICE,
            distance: 0
        };
    }

    // get the fuel price for the selected fuel type
    let fuelPrice = DEFAULT_FUEL_PRICE;
    if (bestStation.fuelPrices) {
        const selectedPrice = bestStation.fuelPrices.get(fuelType);
        if (selectedPrice) {
            fuelPrice = selectedPrice;
        }
    }

    return {
        branchId: bestStation.branchId,
        name: bestStation.name,
        address: bestStation.address,
        fuelPrice: fuelPrice,
        distance: minDist,
        latitude: bestStation.latitude,
        longitude: bestStation.longitude
    };
}

// ================================================================
// HELPER 3: 计算多店路线的最优驾驶距离
// 路线: 家 → 店1 → 店2 → ... → 店N → 家
// 我们会试所有排列组合来找最短路线
// 1 家店: 家 → 店 → 家（简单往返）
// 2 家店: 比 min(家→A→B→家, 家→B→A→家)
// 3 家店: 6 种排列，算起来有点费劲
// ================================================================
async function calculateRouteDistance(userLat, userLng, storeBranches) {
    // storeBranches 是 { branchId, latitude, longitude } 的数组
    if (storeBranches.length === 0) {
        return { routeKm: 0, routeOrder: [] };
    }

    if (storeBranches.length === 1) {
        // 简单往返: 家 → 店 → 家
        // 只需要算从家到那家店的距离

        const distances = await getDistances(userLat, userLng, [{
            branchId: storeBranches[0].branchId,
            latitude: storeBranches[0].latitude,
            longitude: storeBranches[0].longitude
        }]);

        const distToStore = distances[0]?.distanceKm || 0;
        const roundTrip = distToStore * 2; // there and back

        return {
            routeKm: Math.round(roundTrip * 100) / 100,
            routeOrder: [storeBranches[0].branchId]
        };
    }

    // 2+ 家店: 试所有排列组合
    // 先生成所有排列的索引
    const n = storeBranches.length;

    const indices = Array.from({ length: n }, (_, i) => i);
    const perms = getPermutations(indices);

    let bestDist = Infinity;
    let bestOrder = [];

    for (const perm of perms) {
        const orderedStores = perm.map(i => ({
            branchId: storeBranches[i].branchId,
            latitude: storeBranches[i].latitude,
            longitude: storeBranches[i].longitude
        }));

        // calculate total driving distance for this route
        // step by step: home→store1, store1→store2, ..., lastStore→home
        let totalDist = 0;
        let prevLat = userLat;
        let prevLng = userLng;

        for (const store of orderedStores) {
            const segDistances = await getDistances(prevLat, prevLng, [{
                branchId: store.branchId,
                latitude: store.latitude,
                longitude: store.longitude
            }]);
            totalDist += segDistances[0]?.distanceKm || 0;
            prevLat = store.latitude;
            prevLng = store.longitude;
        }

        // last store back home
        const homeDistances = await getDistances(prevLat, prevLng, [{
            branchId: 'home',
            latitude: userLat,
            longitude: userLng
        }]);
        totalDist += homeDistances[0]?.distanceKm || 0;

        if (totalDist < bestDist) {
            bestDist = totalDist;
            bestOrder = orderedStores.map(s => s.branchId);
        }
    }

    return {
        routeKm: Math.round(bestDist * 100) / 100,
        routeOrder: bestOrder
    };
}

// ================================================================
// HELPER 4: 生成数组的所有排列组合
// 被 calculateRouteDistance 调用，用来试所有商店顺序
// 纯数学递归，跟业务逻辑没关系
// ================================================================
function getPermutations(arr) {

    if (arr.length <= 1) return [arr];
    const result = [];

    for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
        const subPerms = getPermutations(remaining);

        for (const sub of subPerms) {
            result.push([current, ...sub]);
        }
    }

    return result;
}

// ================================================================
// HELPER 5: 查每个商品在所有超市里的最低价
// 这个用来算分支定界的"下界"
// 说白了就是：剩下的商品最少要花多少钱
// 注意：这个函数写了但没调用，最下价是在主函数里内联算的
// ================================================================
async function getCheapestPrices(items, supermarkets) {
    const productNames = items.map(item => item.name.toLowerCase());

    // 查所有选中连锁里这些商品的价格

    const priceDocs = await PriceSnapshot.find({
        productName: { $in: productNames },
        chainId: { $in: supermarkets }
    });

    // 对每个商品，在所有连锁里找最便宜的单价

    const cheapestMap = {};
    priceDocs.forEach(doc => {
        if (doc.unitPrice !== null) {
            if (!cheapestMap[doc.productName] || doc.unitPrice < cheapestMap[doc.productName]) {
                cheapestMap[doc.productName] = doc.unitPrice;
            }
        }
    });

    return cheapestMap;
}

// ================================================================
// HELPER 6: 查某个商品在某连锁的价格
// 用来算每种分配方案的实际花费
// 注意：这个函数写了但没调用，priceMap 预加载覆盖了
// ================================================================
async function getItemPrice(itemName, chainId) {
    const doc = await PriceSnapshot.findOne({
        productName: itemName.toLowerCase(),
        chainId: chainId
    });

    if (doc && doc.unitPrice !== null) {
        return doc.unitPrice;
    }
    return null; // 查不到价格
}

// ================================================================
// 主函数: 用分支定界生成购物方案
//
// 算法流程:
// 1. 找每个品牌最近的超市分店
// 2. 找最近的加油站
// 3. 算初始上界（找几个一站式方案里最好的）
// 4. 递归尝试所有分配方案，把不可能比上界好的分支剪掉
// 5. 返回前 10 个方案，按真实成本排序
// ================================================================
async function generatePlans({ items, supermarkets, userLat, userLng, fuelType }) {
    // ==================== 第一阶段：预加载数据 ====================

    // 第1步: 找每个超市连锁离用户最近的分店
    const nearestBranches = await findNearestBranches(supermarkets, userLat, userLng);

    // 只保留有分店的品牌
    const availableChains = Object.keys(nearestBranches);
    if (availableChains.length === 0) {
        return []; // 一个超市都没有，返回空数组
    }

    // 第2步: 找最近的加油站
    const fuelStation = await findBestFuelStation(userLat, userLng, fuelType);

    // 第3步: 预加载所有价格，省得递归时反复查数据库
    // priceMap[chainId][productName] = 单价

    const priceMap = {};
    for (const chainId of availableChains) {
        priceMap[chainId] = {};
    }

    const productNames = items.map(item => item.name.toLowerCase());
    const allPrices = await PriceSnapshot.find({
        productName: { $in: productNames },
        chainId: { $in: availableChains }
    });

    allPrices.forEach(doc => {
        if (!priceMap[doc.chainId]) priceMap[doc.chainId] = {};
        if (doc.unitPrice !== null) {
            priceMap[doc.chainId][doc.productName] = doc.unitPrice;
        }
    });

    // 第4步: 算每个商品的最低价（用来算分支定界的下界）

    const cheapestPrices = {};
    for (const item of items) {
        const name = item.name.toLowerCase();
        let cheapest = Infinity;
        for (const chainId of availableChains) {
            const price = priceMap[chainId]?.[name];
            if (price !== undefined && price !== null && price < cheapest) {
                cheapest = price;
            }
        }
        if (cheapest !== Infinity) {
            cheapestPrices[name] = cheapest;
        }
    }

    // ==================== 第二阶段：算初始上界 ====================

    // 上界 = 最好的一站式方案（全部在一家超市买）
    // 同时把这些方案存起来作为有效方案

    const allPlans = [];
    let upperBound = Infinity;

    for (const chainId of availableChains) {
        const branchInfo = nearestBranches[chainId];
        if (!branchInfo) continue;

        // 算这个连锁的杂货总价

        let groceryTotal = 0;
        let hasMissing = false;
        let itemBreakdown = [];

        for (const item of items) {
            const name = item.name.toLowerCase();
            const unitPrice = priceMap[chainId]?.[name];

            if (unitPrice !== undefined && unitPrice !== null) {
                const total = unitPrice * item.quantity;
                groceryTotal += total;
                itemBreakdown.push({
                    name: item.name,
                    quantity: item.quantity,
                    unitPrice: unitPrice,
                    total: total,
                    store: chainId
                });
            } else {
                hasMissing = true;
            }
        }

        // fuel cost = round trip to this store
        const roundTripKm = branchInfo.distance * 2;
        const fuelCost = Math.round((roundTripKm / DEFAULT_FUEL_EFFICIENCY) * fuelStation.fuelPrice * 100) / 100;
        groceryTotal = Math.round(groceryTotal * 100) / 100;
        const trueCost = Math.round((groceryTotal + fuelCost) * 100) / 100;

        const plan = {
            strategy: 'single',
            trueCost: trueCost,
            groceryTotal: groceryTotal,
            fuelCost: fuelCost,
            fuelPrice: fuelStation.fuelPrice,
            routeDistance: roundTripKm,
            stores: [{
                chainId: chainId,
                branchId: branchInfo.branchId,
                branchName: branchInfo.branchName,
                address: branchInfo.address,
                branchDistance: branchInfo.distance,
                items: items.map(i => ({ name: i.name, quantity: i.quantity }))
            }],
            route: [branchInfo.branchId],
            recommendedFuelStation: {
                name: fuelStation.name,
                address: fuelStation.address || '',
                distance: fuelStation.distance,
                fuelPrice: fuelStation.fuelPrice
            },
            fuelType: fuelType,
            hasMissingPrice: hasMissing,
            breakdown: itemBreakdown,
            // for ranking later
            storeCount: 1
        };

        allPlans.push(plan);

        if (trueCost < upperBound) {
            upperBound = trueCost;
        }
    }

    // ==================== PHASE 3: Branch and Bound search ====================

    // if there's only 1 chain available, no need to do B&B
    if (availableChains.length >= 2) {
        // these variables get used inside the recursive function
        let bestUpperBound = upperBound;

        // recursive branch and bound function
        async function branchAndBound(
            assignedItems,    // items we've already decided where to buy
            remainingItems,   // items still need to be assigned
            storesVisited,    // set of chainIds we'll need to visit
            currentGroceries  // total grocery cost so far
        ) {
            // LOWER BOUND calculation
            // = current grocery total + cheapest possible for remaining items + minimal fuel cost
            let remainingCheapest = 0;
            for (const item of remainingItems) {
                const name = item.name.toLowerCase();
                const cheapest = cheapestPrices[name];
                if (cheapest !== undefined && cheapest !== null && cheapest !== Infinity) {
                    remainingCheapest += cheapest * item.quantity;
                } else {
                    // item has no price anywhere, that's bad
                    // we can't calculate lower bound properly, so just skip this branch
                    return;
                }
            }

            // minimal fuel cost: even if we only visit 1 store, what's the minimum fuel cost
            let minFuelCost = Infinity;
            for (const chainId of storesVisited) {
                const branchInfo = nearestBranches[chainId];
                if (branchInfo) {
                    const fuel = (branchInfo.distance * 2 / DEFAULT_FUEL_EFFICIENCY) * fuelStation.fuelPrice;
                    if (fuel < minFuelCost) minFuelCost = fuel;
                }
            }
            if (minFuelCost === Infinity) minFuelCost = 0;

            const lowerBound = currentGroceries + remainingCheapest + minFuelCost;

            // PRUNE: if lower bound is already >= best known, cut this branch
            if (lowerBound >= bestUpperBound) {
                return;
            }

            // BASE CASE: no items left to assign
            if (remainingItems.length === 0) {
                // we have a complete allocation, calculate its true cost properly
                const storeBranches = Array.from(storesVisited).map(chainId => ({
                    branchId: nearestBranches[chainId].branchId,
                    latitude: nearestBranches[chainId].latitude,
                    longitude: nearestBranches[chainId].longitude
                }));

                const routeInfo = await calculateRouteDistance(userLat, userLng, storeBranches);
                const fuelCost = Math.round((routeInfo.routeKm / DEFAULT_FUEL_EFFICIENCY) * fuelStation.fuelPrice * 100) / 100;
                const trueCost = Math.round((currentGroceries + fuelCost) * 100) / 100;

                // group items by store
                const storeGroups = {};
                for (const assigned of assignedItems) {
                    if (!storeGroups[assigned.store]) {
                        storeGroups[assigned.store] = [];
                    }
                    storeGroups[assigned.store].push({
                        name: assigned.name,
                        quantity: assigned.quantity,
                        unitPrice: assigned.unitPrice,
                        total: assigned.total
                    });
                }

                const storesDetail = Array.from(storesVisited).map(chainId => {
                    const branchInfo = nearestBranches[chainId];
                    return {
                        chainId: chainId,
                        branchId: branchInfo.branchId,
                        branchName: branchInfo.branchName,
                        address: branchInfo.address,
                        branchDistance: branchInfo.distance,
                        items: storeGroups[chainId]?.map(i => ({
                            name: i.name,
                            quantity: i.quantity
                        })) || []
                    };
                });

                const plan = {
                    strategy: storesVisited.size === 1 ? 'single' : 'split',
                    trueCost: trueCost,
                    groceryTotal: Math.round(currentGroceries * 100) / 100,
                    fuelCost: fuelCost,
                    fuelPrice: fuelStation.fuelPrice,
                    routeDistance: routeInfo.routeKm,
                    stores: storesDetail,
                    route: routeInfo.routeOrder,
                    recommendedFuelStation: {
                        name: fuelStation.name,
                        address: fuelStation.address || '',
                        distance: fuelStation.distance,
                        fuelPrice: fuelStation.fuelPrice
                    },
                    fuelType: fuelType,
                    hasMissingPrice: false,
                    breakdown: assignedItems.map(i => ({
                        name: i.name,
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                        total: i.total,
                        store: i.store
                    })),
                    storeCount: storesVisited.size
                };

                allPlans.push(plan);

                // update upper bound if this plan is better
                if (trueCost < bestUpperBound) {
                    bestUpperBound = trueCost;
                }
                return;
            }

            // RECURSIVE CASE: assign the next item to each possible store
            const nextItem = remainingItems[0];
            const nextName = nextItem.name.toLowerCase();
            const newRemaining = remainingItems.slice(1);

            for (const chainId of availableChains) {
                const unitPrice = priceMap[chainId]?.[nextName];
                if (unitPrice === undefined || unitPrice === null) {
                    // this item isn't sold at this chain, skip
                    continue;
                }

                const itemTotal = unitPrice * nextItem.quantity;
                const newStores = new Set(storesVisited);
                newStores.add(chainId);

                // optimization: if we already have 4+ stores, the fuel cost will be huge
                // realistically nobody wants to visit 4+ stores, prune early
                if (newStores.size > 3) continue;

                await branchAndBound(
                    [...assignedItems, {
                        name: nextItem.name,
                        quantity: nextItem.quantity,
                        unitPrice: unitPrice,
                        total: itemTotal,
                        store: chainId
                    }],
                    newRemaining,
                    newStores,
                    currentGroceries + itemTotal
                );
            }
        }

        // start the recursive search from empty assignment
        await branchAndBound([], items, new Set(), 0);
    }

    // ==================== PHASE 4: Sort and rank ====================

    // remove duplicates (same stores and same true cost)
    const uniquePlans = [];
    const seen = new Set();

    for (const plan of allPlans) {
        const key = `${plan.strategy}-${plan.stores.map(s => s.chainId).sort().join(',')}-${plan.trueCost.toFixed(2)}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniquePlans.push(plan);
        }
    }

    // sort by true cost (cheapest first)
    uniquePlans.sort((a, b) => a.trueCost - b.trueCost);

    // assign ranks
    uniquePlans.forEach((plan, index) => {
        plan.rank = index + 1;
    });

    // return top 10 plans (but at least show all single-store plans)
    const minPlans = Math.min(availableChains.length, 3);
    const maxPlans = Math.max(10, minPlans);
    const resultPlans = uniquePlans.slice(0, maxPlans);

    return resultPlans;
}

module.exports = { generatePlans };

// trueCostService.js
// this service calculates the "True Cost" for each supermarket branch
// True Cost = (grocery total) + (fuel cost to drive there and back)
//
// fuel cost = (round trip distance / fuel efficiency) × fuel price
// fuel efficiency default: 10 km/L (New Zealand average)
// if user selected a fuel station, use that station's fuel price
// otherwise, use default fuel price of $2.80/L for 91

const PriceSnapshot = require('../models/PriceSnapshot');
const Branch = require('../models/Branch');
const { getDistances } = require('./distanceService');

// default values
const DEFAULT_FUEL_EFFICIENCY = 10; // km per liter
const DEFAULT_FUEL_PRICE = 2.80;    // $ per liter (91 octane)

// get grocery prices for items from a specific supermarket chain
// returns the total cost for all items at that chain
async function getGroceryTotal(items, chainId) {
    const productNames = items.map(item => item.name.toLowerCase());

    const priceDocs = await PriceSnapshot.find({
        productName: { $in: productNames },
        chainId: chainId
    });

    // build a map for fast lookup: productName → priceDoc
    const priceMap = {};
    priceDocs.forEach(doc => {
        priceMap[doc.productName] = doc;
    });

    // calculate total: sum of (quantity × unitPrice) for each item
    let total = 0;
    let hasMissingPrice = false;

    items.forEach(item => {
        const lowerName = item.name.toLowerCase();
        const priceDoc = priceMap[lowerName];
        if (priceDoc && priceDoc.unitPrice !== null) {
            total += priceDoc.unitPrice * item.quantity;
        } else {
            hasMissingPrice = true;
        }
    });

    return {
        total: Math.round(total * 100) / 100,
        hasMissingPrice
    };
}

// main function: calculate true cost for all supermarket branches
// receives: items, supermarkets (chainIds), fuelStationBranchId, fuelType, userLat, userLng
async function calculateTrueCost({ items, supermarkets, fuelStationBranchId, fuelType, userLat, userLng }) {
    // Step 1: get the fuel price
    let fuelPrice = DEFAULT_FUEL_PRICE;

    if (fuelStationBranchId) {
        // user selected a specific fuel station — get its fuelPrices
        const fuelStation = await Branch.findOne({ branchId: fuelStationBranchId, isActive: true });
        if (fuelStation && fuelStation.fuelPrices) {
            const fuelPrices = fuelStation.fuelPrices;
            // fuelPrices is a Map, fuelType is "91", "95", or "diesel"
            const selectedPrice = fuelPrices.get(fuelType);
            if (selectedPrice) {
                fuelPrice = selectedPrice;
            }
        }
    }

    // Step 2: get all supermarket branches that belong to the selected supermarket chains
    const supermarketBranches = await Branch.find({
        chainId: { $in: supermarkets },
        type: 'supermarket',
        isActive: true
    });

    // Step 3: get distances from user to each supermarket branch
    const distanceResults = await getDistances(
        userLat,
        userLng,
        supermarketBranches.map(b => ({
            branchId: b.branchId,
            latitude: b.latitude,
            longitude: b.longitude
        }))
    );

    // build a distance map: branchId → distanceKm
    const distanceMap = {};
    distanceResults.forEach(d => {
        distanceMap[d.branchId] = d.distanceKm;
    });

    // Step 4: calculate true cost for each supermarket branch
    const results = [];

    for (const branch of supermarketBranches) {
        const distanceKm = distanceMap[branch.branchId] || 0;

        // get grocery total for this branch's supermarket chain
        const grocery = await getGroceryTotal(items, branch.chainId);

        // calculate fuel cost for round trip
        // round trip = distance × 2 (drive there and back)
        const roundTripKm = distanceKm * 2;
        const fuelCost = Math.round((roundTripKm / DEFAULT_FUEL_EFFICIENCY) * fuelPrice * 100) / 100;

        // true cost = groceries + fuel
        const trueCost = Math.round((grocery.total + fuelCost) * 100) / 100;

        results.push({
            branchId: branch.branchId,
            branchName: branch.name,
            chainId: branch.chainId,
            address: branch.address,
            distanceKm: distanceKm,
            groceryTotal: grocery.total,
            hasMissingPrice: grocery.hasMissingPrice,
            fuelPrice: fuelPrice,
            fuelCost: fuelCost,
            trueCost: trueCost
        });
    }

    // Step 5: sort by true cost (cheapest first)
    results.sort((a, b) => a.trueCost - b.trueCost);

    // add rank
    results.forEach((r, index) => {
        r.rank = index + 1;
    });

    return results;
}

module.exports = { calculateTrueCost };

// Price Fetching Service
// Handles database queries for price matching between items and stores

const PriceSnapshot = require('../models/PriceSnapshot');

/**
 * Get prices for a list of items across multiple stores
 * @param {Array} items - [{ name: "Bread", quantity: 2 }, ...]
 * @param {Array} stores - ["paknsave", "newworld", ...]
 * @returns {Array} - [{ itemName, quantity, paknsave: {...}, newworld: {...} }, ...]
 */
async function getPricesForItems(items, stores) {
    // Collect all product names (lowercase for case-insensitive matching)
    const productNames = items.map(item => item.name.toLowerCase());

    // Single database query for all requested products and stores
    const priceDocs = await PriceSnapshot.find({
        productName: { $in: productNames },
        chainId: { $in: stores }
    });

    // Build a fast lookup map: key = "productName#chainId"
    const priceMap = {};
    priceDocs.forEach(doc => {
        const key = `${doc.productName}#${doc.chainId}`;
        priceMap[key] = {
            price: doc.price,
            unit: doc.unit,
            baseUnit: doc.baseUnit,
            unitPrice: doc.unitPrice,
            category: doc.category
        };
    });

    // Assemble results in the same format as before
    const results = items.map(item => {
        const row = {
            itemName: item.name,
            quantity: item.quantity
        };

        const lowerName = item.name.toLowerCase();
        stores.forEach(store => {
            const key = `${lowerName}#${store}`;
            row[store] = priceMap[key] || null;
        });

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
        // Group by productName, take the first baseUnit encountered
        {
            $group: {
                _id: "$productName",
                baseUnit: { $first: "$baseUnit" }
            }
        },
        // Rename _id to name for frontend compatibility
        {
            $project: {
                _id: 0,
                name: "$_id",
                baseUnit: 1
            }
        }
    ]);

    return products;
}

module.exports = { getPricesForItems, getAllProducts };

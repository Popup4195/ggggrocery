// importing the necessary packages
const express = require('express');
const cors = require('cors');
const path = require('path');
const { validateGroceryList } = require('./validators/inputValidator');
const { getPricesForItems, getAllProducts } = require('./services/priceService');
const { calculateTrueCost } = require('./services/trueCostService');
const { generatePlans } = require('./services/planService');
const { generateWalkingPlans } = require('./services/walkingPlanService');


// Load environment variables from root .env.local
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

// MongoDB connection using Mongoose
const mongoose = require('mongoose');
const Chain = require('./models/Chain');
const Branch = require('./models/Branch');

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// initials express app
const app = express();

// set up Middleware
app.use(cors()); // allows React app to make requests to the server
app.use(express.json()); // tells the server to understand imcoming json data

// GET endpoint: return all active chains (brands) for dynamic store selection
// FR17: supports ?type=supermarket or ?type=fuel_station to filter results
app.get('/api/chains', async (req, res) => {
    try {
        const filter = { isActive: true };
        // FR17: if ?type is provided, filter by that type
        if (req.query.type) {
            filter.type = req.query.type;
        }
        const chains = await Chain.find(filter).select('chainId name type -_id');
        res.json(chains);
    } catch (error) {
        console.error('Error fetching chains:', error);
        res.status(500).json({ error: 'Failed to fetch chains' });
    }
});

// GET endpoint: return all active branches for a given chainId
// FR17: supports ?type=fuel_station filter and returns fuelPrices for fuel stations
app.get('/api/branches', async (req, res) => {
    try {
        const { chainId } = req.query;
        const filter = { isActive: true };
        if (chainId) {
            filter.chainId = chainId.toLowerCase();
        }
        // FR17: if ?type is provided, filter by that type
        if (req.query.type) {
            filter.type = req.query.type;
        }
        // FR17: include fuelPrices in the response for fuel station branches
        const branches = await Branch.find(filter).select('branchId chainId name address latitude longitude type fuelPrices -_id');
        res.json(branches);
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
});

// GET endpoint: return all products with their baseUnit (for auto-complete in frontend)
app.get('/api/products', async (req, res) => {
    try {
        const products = await getAllProducts();
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// creating the POST endpoint for Price Comparison
app.post('/api/compare', validateGroceryList, async (req, res) => {
    const { items, stores } = req.body;

    try {
        const results = await getPricesForItems(items, stores);
        res.json(results);
    } catch (error) {
        console.error('Price comparison error:', error);
        res.status(500).json({ error: 'Failed to compare prices' });
    }
});

// FR17: POST endpoint for True Cost calculation
// receives: items (grocery list), supermarkets (selected supermarket chainIds),
//           fuelStationBranchId (selected fuel station), fuelType (91/95/diesel),
//           userLat (user's latitude), userLng (user's longitude)
// returns: true cost results for each supermarket branch
app.post('/api/true-cost', async (req, res) => {
    const { items, supermarkets, fuelStationBranchId, fuelType, userLat, userLng } = req.body;

    try {
        const results = await calculateTrueCost({
            items,
            supermarkets,
            fuelStationBranchId,
            fuelType,
            userLat,
            userLng
        });
        res.json(results);
    } catch (error) {
        console.error('True cost calculation error:', error);
        res.status(500).json({ error: 'Failed to calculate true cost' });
    }
});

// FR07: POST endpoint — shopping plan generation engine
// 支持两种交通模式:
//   transportMode = 'driving' → 走分支定界算法（包含油费和路线距离）
//   transportMode = 'walking' → 走步行算法（只算距离和杂货总价）
// 接收: items, supermarkets, transportMode, userLat, userLng
//       driving 模式额外: fuelType
//       walking 模式额外: walkingMaxKm（optional, default 2km）
// 返回: 按总价排序的方案列表

app.post('/api/plans', async (req, res) => {
    const { items, supermarkets, transportMode, fuelType, userLat, userLng, walkingMaxKm } = req.body;

    // basic validation — make sure all required fields are present

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Please provide at least one grocery item.' });
    }
    if (!supermarkets || supermarkets.length === 0) {
        return res.status(400).json({ error: 'Please select at least one supermarket.' });
    }
    if (!userLat || !userLng) {
        return res.status(400).json({ error: 'Please provide your location (latitude and longitude).' });
    }

    const mode = transportMode || 'driving';

    try {
        if (mode === 'walking') {
            // walking mode: call walkingPlanService

            const result = await generateWalkingPlans({
                items,
                supermarkets,
                userLat: parseFloat(userLat),
                userLng: parseFloat(userLng),
                walkingMaxKm: walkingMaxKm || 2.0
            });
            if (result.message) {
                // no walkable supermarkets found
                return res.status(200).json({ plans: [], message: result.message, globallyUnavailableItems: result.globallyUnavailableItems || [] });
            }
            return res.json({ plans: result.plans, message: null, globallyUnavailableItems: result.globallyUnavailableItems || [] });
        } else {
            // driving mode: use the branch-and-bound algorithm
            const result = await generatePlans({

                items,
                supermarkets,
                fuelType: fuelType || '91',
                userLat: parseFloat(userLat),
                userLng: parseFloat(userLng)
            });
            res.json({ plans: result.plans, message: null, globallyUnavailableItems: result.globallyUnavailableItems || [] });
        }
    } catch (error) {
        console.error('Plan generation error:', error);
        res.status(500).json({ error: 'Failed to generate shopping plans.' });
    }
});


// start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

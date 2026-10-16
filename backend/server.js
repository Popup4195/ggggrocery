// importing the necessary packages
const express = require('express');
const cors = require('cors');
const path = require('path');
const { validateGroceryList } = require('./validators/inputValidator');
const { getPricesForItems, getAllProducts } = require('./services/priceService');
const { calculateTrueCost } = require('./services/trueCostService');
const { generatePlans } = require('./services/planService');
const { generateWalkingPlans } = require('./services/walkingPlanService');
const { validateBranchIds } = require('./services/branchSelection');


// Load environment variables from root .env.local
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

// MongoDB connection using Mongoose
const mongoose = require('mongoose');
const Chain = require('./models/Chain');
const Branch = require('./models/Branch');
const ShoppingList = require('./models/ShoppingList');

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
    const { items, transportMode, fuelType, userLat, userLng, walkingMaxKm, branchIds } = req.body;
    let { supermarkets } = req.body;

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

    // optional manual branch selection (max 7 across all chains)
    if (branchIds !== undefined) {
        const branchIdsError = validateBranchIds(branchIds);
        if (branchIdsError) {
            return res.status(400).json({ error: branchIdsError });
        }
    }

    const mode = transportMode || 'driving';

    try {
        let allowedBranchIds;
        if (branchIds && branchIds.length > 0) {
            const selectedBranches = await Branch.find({
                branchId: { $in: branchIds },
                type: 'supermarket',
                isActive: true
            }).lean();
            const foundIds = new Set(selectedBranches.map(b => b.branchId));
            const unknownIds = branchIds.filter(id => !foundIds.has(id));
            if (unknownIds.length > 0) {
                return res.status(400).json({ error: `Unknown branch IDs: ${unknownIds.join(', ')}` });
            }
            // only plan with chains that have at least one ticked branch
            const selectedChainIds = new Set(selectedBranches.map(b => b.chainId));
            supermarkets = supermarkets.filter(chainId => selectedChainIds.has(chainId));
            if (supermarkets.length === 0) {
                return res.status(400).json({ error: 'None of the selected branches belong to the selected supermarkets.' });
            }
            allowedBranchIds = selectedBranches.map(b => b.branchId);
        }

        if (mode === 'walking') {
            // walking mode: call walkingPlanService

            const result = await generateWalkingPlans({
                items,
                supermarkets,
                userLat: parseFloat(userLat),
                userLng: parseFloat(userLng),
                walkingMaxKm: walkingMaxKm || 2.0,
                allowedBranchIds
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
                userLng: parseFloat(userLng),
                allowedBranchIds
            });
            res.json({ plans: result.plans, message: null, globallyUnavailableItems: result.globallyUnavailableItems || [] });
        }
    } catch (error) {
        console.error('Plan generation error:', error);
        res.status(500).json({ error: 'Failed to generate shopping plans.' });
    }
});


// ========== FR-S1: shareable shopping list links (guest mode, no login) ==========
// No auth on any of these — anyone holding the link can view and edit the list.
// This trade-off (no permission control) has been confirmed acceptable for this pass.

// POST endpoint: create a new shareable list, returns its id
app.post('/api/lists', async (req, res) => {
    try {
        const { items, selectedChains, transportMode, fuelType, walkingMaxKm } = req.body;
        const list = await ShoppingList.create({
            items: items || [],
            selectedChains: selectedChains || [],
            transportMode: transportMode || 'driving',
            fuelType: fuelType || '91',
            walkingMaxKm: walkingMaxKm ?? 2.0
        });
        res.status(201).json({ id: list._id });
    } catch (error) {
        console.error('Error creating shopping list:', error);
        res.status(500).json({ error: 'Failed to create shopping list' });
    }
});

// GET endpoint: fetch a shared list's items + saved plan settings by id
// (note: location is deliberately not part of this payload — the viewer supplies their own)
app.get('/api/lists/:id', async (req, res) => {
    try {
        const list = await ShoppingList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }
        res.json({
            id: list._id,
            items: list.items,
            selectedChains: list.selectedChains,
            transportMode: list.transportMode,
            fuelType: list.fuelType,
            walkingMaxKm: list.walkingMaxKm
        });
    } catch (error) {
        // includes invalid ObjectId format, which Mongoose throws a CastError for
        console.error('Error fetching shopping list:', error);
        res.status(404).json({ error: 'List not found' });
    }
});

// PUT endpoint: update a shared list's items + plan settings (anyone with the link can edit)
app.put('/api/lists/:id', async (req, res) => {
    try {
        const { items, selectedChains, transportMode, fuelType, walkingMaxKm } = req.body;
        const list = await ShoppingList.findByIdAndUpdate(
            req.params.id,
            {
                items: items || [],
                selectedChains: selectedChains || [],
                transportMode: transportMode || 'driving',
                fuelType: fuelType || '91',
                walkingMaxKm: walkingMaxKm ?? 2.0
            },
            { new: true, runValidators: true }
        );
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }
        res.json({
            id: list._id,
            items: list.items,
            selectedChains: list.selectedChains,
            transportMode: list.transportMode,
            fuelType: list.fuelType,
            walkingMaxKm: list.walkingMaxKm
        });
    } catch (error) {
        console.error('Error updating shopping list:', error);
        res.status(404).json({ error: 'List not found' });
    }
});

// start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});
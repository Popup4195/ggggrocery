const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const mongoose = require('mongoose');
const Chain = require('./models/Chain');
const Branch = require('./models/Branch');
const PriceSnapshot = require('./models/PriceSnapshot');

async function seed() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // === Clear existing data ===
        await Chain.deleteMany({});
        await Branch.deleteMany({});
        await PriceSnapshot.deleteMany({});
        console.log('Cleared all existing data');

        // === Seed Chains (brands) — supermarkets + fuel stations ===
        const chains = await Chain.insertMany([
            // --- Supermarkets (type: supermarket) ---
            {
                chainId: 'paknsave',
                name: "Pak'nSave",
                jsonFile: 'paknsave.json',
                type: 'supermarket',
                isActive: true
            },
            {
                chainId: 'newworld',
                name: 'New World',
                jsonFile: 'newWorld.json',
                type: 'supermarket',
                isActive: true
            },
            {
                chainId: 'countdown',
                name: 'Countdown',
                jsonFile: 'countdown.json',
                type: 'supermarket',
                isActive: true
            },
            // --- Fuel stations (type: fuel_station) ---
            {
                chainId: 'z',
                name: 'Z',
                jsonFile: '',
                type: 'fuel_station',
                isActive: true
            },
            {
                chainId: 'bp',
                name: 'BP',
                jsonFile: '',
                type: 'fuel_station',
                isActive: true
            },
            {
                chainId: 'mobil',
                name: 'Mobil',
                jsonFile: '',
                type: 'fuel_station',
                isActive: true
            }
        ]);
        console.log(`Seeded ${chains.length} chains:`);
        chains.forEach(c => console.log(`  - ${c.name} (${c.chainId}) [${c.type}]`));

        // === Seed Branches — supermarkets + fuel stations ===
        const branches = await Branch.insertMany([
            // --- Pak'nSave branches (Wellington area) ---
            {
                branchId: 'paknsave_porirua',
                chainId: 'paknsave',
                name: "Pak'nSave Porirua",
                address: 'Cnr James Cook Dr &, State Highway 1, Porirua 5022',
                latitude: -41.1315,
                longitude: 174.8417,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'paknsave_kilbirnie',
                chainId: 'paknsave',
                name: "Pak'nSave Kilbirnie",
                address: '92-116 Kilbirnie Crescent, Kilbirnie, Wellington 6022',
                latitude: -41.2855,
                longitude: 174.7948,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'paknsave_wellington',
                chainId: 'paknsave',
                name: "Pak'nSave Wellington",
                address: '322-328 Vivian Street, Te Aro, Wellington 6011',
                latitude: -41.2933,
                longitude: 174.7717,
                type: 'supermarket',
                isActive: true
            },

            // --- New World branches (Wellington area) ---
            {
                branchId: 'newworld_chaffers',
                chainId: 'newworld',
                name: 'New World Chaffers',
                address: '6-8 Cambridge Terrace, Te Aro, Wellington 6011',
                latitude: -41.2920,
                longitude: 174.7805,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'newworld_miramar',
                chainId: 'newworld',
                name: 'New World Miramar',
                address: '6 Park Road, Miramar, Wellington 6022',
                latitude: -41.3122,
                longitude: 174.8230,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'newworld_porirua',
                chainId: 'newworld',
                name: 'New World Porirua',
                address: '8-12 Hartham Place, Porirua 5022',
                latitude: -41.1397,
                longitude: 174.8487,
                type: 'supermarket',
                isActive: true
            },

            // --- Countdown branches (Wellington area) ---
            {
                branchId: 'countdown_tearo',
                chainId: 'countdown',
                name: 'Countdown Te Aro',
                address: '40-44 Taranaki Street, Te Aro, Wellington 6011',
                latitude: -41.2960,
                longitude: 174.7758,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'countdown_newtown',
                chainId: 'countdown',
                name: 'Countdown Newtown',
                address: '157-163 Riddiford Street, Newtown, Wellington 6021',
                latitude: -41.3105,
                longitude: 174.7799,
                type: 'supermarket',
                isActive: true
            },
            {
                branchId: 'countdown_johnsonville',
                chainId: 'countdown',
                name: 'Countdown Johnsonville',
                address: '8 Johnsonville Road, Johnsonville, Wellington 6037',
                latitude: -41.2222,
                longitude: 174.8081,
                type: 'supermarket',
                isActive: true
            },

            // --- Z fuel stations ---
            {
                branchId: 'z_lambton',
                chainId: 'z',
                name: 'Z Lambton',
                address: '45 Bunny Street, Wellington 6011',
                latitude: -41.2830,
                longitude: 174.7760,
                type: 'fuel_station',
                fuelPrices: { '91': 2.80, '95': 2.95, 'diesel': 2.20 },
                isActive: true
            },
            {
                branchId: 'z_porirua',
                chainId: 'z',
                name: 'Z Porirua',
                address: '18 Hagley Street, Porirua 5022',
                latitude: -41.1360,
                longitude: 174.8430,
                type: 'fuel_station',
                fuelPrices: { '91': 2.78, '95': 2.93, 'diesel': 2.18 },
                isActive: true
            },
            {
                branchId: 'z_kilbirnie',
                chainId: 'z',
                name: 'Z Kilbirnie',
                address: '104 Bay Road, Kilbirnie, Wellington 6022',
                latitude: -41.2860,
                longitude: 174.7940,
                type: 'fuel_station',
                fuelPrices: { '91': 2.79, '95': 2.94, 'diesel': 2.19 },
                isActive: true
            },

            // --- BP fuel stations ---
            {
                branchId: 'bp_lambton',
                chainId: 'bp',
                name: 'BP Lambton',
                address: '1 Bowen Street, Wellington 6011',
                latitude: -41.2840,
                longitude: 174.7740,
                type: 'fuel_station',
                fuelPrices: { '91': 2.82, '95': 2.97, 'diesel': 2.22 },
                isActive: true
            },
            {
                branchId: 'bp_porirua',
                chainId: 'bp',
                name: 'BP Porirua',
                address: '15 Cobham Court, Porirua 5022',
                latitude: -41.1370,
                longitude: 174.8440,
                type: 'fuel_station',
                fuelPrices: { '91': 2.80, '95': 2.95, 'diesel': 2.20 },
                isActive: true
            },
            {
                branchId: 'bp_kilbirnie',
                chainId: 'bp',
                name: 'BP Kilbirnie',
                address: '169 Rongotai Road, Kilbirnie, Wellington 6022',
                latitude: -41.2870,
                longitude: 174.7950,
                type: 'fuel_station',
                fuelPrices: { '91': 2.81, '95': 2.96, 'diesel': 2.21 },
                isActive: true
            },

            // --- Mobil fuel stations ---
            {
                branchId: 'mobil_lambton',
                chainId: 'mobil',
                name: 'Mobil Lambton',
                address: '70 Willis Street, Wellington 6011',
                latitude: -41.2850,
                longitude: 174.7750,
                type: 'fuel_station',
                fuelPrices: { '91': 2.79, '95': 2.94, 'diesel': 2.19 },
                isActive: true
            },
            {
                branchId: 'mobil_porirua',
                chainId: 'mobil',
                name: 'Mobil Porirua',
                address: '3 Hagley Street, Porirua 5022',
                latitude: -41.1350,
                longitude: 174.8420,
                type: 'fuel_station',
                fuelPrices: { '91': 2.77, '95': 2.92, 'diesel': 2.17 },
                isActive: true
            },
            {
                branchId: 'mobil_kilbirnie',
                chainId: 'mobil',
                name: 'Mobil Kilbirnie',
                address: '54 Kilbirnie Crescent, Kilbirnie, Wellington 6022',
                latitude: -41.2850,
                longitude: 174.7930,
                type: 'fuel_station',
                fuelPrices: { '91': 2.78, '95': 2.93, 'diesel': 2.18 },
                isActive: true
            }
        ]);
        console.log(`Seeded ${branches.length} branches:`);
        branches.forEach(b => console.log(`  - ${b.name} (${b.branchId}) [${b.type}]`));

        // === Seed Price Snapshots (product prices per supermarket chain) ===
        // Only supermarkets have product data; fuel stations don't sell groceries
        const supermarketChains = chains.filter(c => c.type === 'supermarket');

        const priceDocs = [];

        supermarketChains.forEach(chain => {
            const rawData = fs.readFileSync(`${__dirname}/${chain.jsonFile}`, 'utf8');
            const data = JSON.parse(rawData);

            Object.keys(data).forEach(productName => {
                const product = data[productName];
                priceDocs.push({
                    productName: productName.toLowerCase(),
                    chainId: chain.chainId,
                    price: product.price !== undefined ? product.price : null,
                    unit: product.unit || '',
                    baseUnit: product.baseUnit || '',
                    unitPrice: product.unitPrice !== undefined ? product.unitPrice : null,
                    category: product.category || '',
                    lastUpdated: new Date()
                });
            });
        });

        await PriceSnapshot.insertMany(priceDocs);
        console.log(`Seeded ${priceDocs.length} price snapshots:`);
        const grouped = {};
        priceDocs.forEach(p => {
            if (!grouped[p.chainId]) grouped[p.chainId] = [];
            grouped[p.chainId].push(p.productName);
        });
        Object.keys(grouped).forEach(chainId => {
            console.log(`  - ${chainId}: ${grouped[chainId].length} products`);
        });

        await mongoose.disconnect();
        console.log('Seed complete!');
    } catch (error) {
        console.error('Seed error:', error);
        process.exit(1);
    }
}

seed();

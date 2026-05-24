const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
    branchId: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    chainId: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    name: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    // FR17: we add a type field to tell if this branch is a supermarket or a fuel station
    // this is the same as Chain.type, but having it here makes queries easier
    type: {
        type: String,
        enum: ['supermarket', 'fuel_station'],
        default: 'supermarket'
    },
    // FR17: fuelPrices is only used for fuel stations
    // it stores the price per liter for each fuel type
    // example: { "91": 2.80, "95": 2.95, "diesel": 2.20 }
    // supermarkets don't have this field (it stays null)
    fuelPrices: {
        type: Map,
        of: Number,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Branch', branchSchema);

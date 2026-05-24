const mongoose = require('mongoose');

const chainSchema = new mongoose.Schema({
    chainId: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    name: {
        type: String,
        required: true
    },
    // FR17: jsonFile is no longer required — fuel stations don't have product JSON files
    // only supermarkets reference a JSON file for their product prices
    jsonFile: {
        type: String,
        default: ''
    },
    // FR17: type field tells if this chain is a supermarket or a fuel station
    // supermarkets: Pak'nSave, New World, Countdown
    // fuel stations: Z, BP, Mobil
    type: {
        type: String,
        enum: ['supermarket', 'fuel_station'],
        default: 'supermarket'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Chain', chainSchema);

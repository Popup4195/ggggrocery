const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
    storeId: {
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
    jsonFile: {
        type: String,
        required: true
    },
    address: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Store', storeSchema);

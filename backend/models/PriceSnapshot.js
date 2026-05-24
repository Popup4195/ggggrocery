const mongoose = require('mongoose');

const priceSnapshotSchema = new mongoose.Schema({
    productName: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    chainId: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    price: {
        type: Number,
        default: null
    },
    unit: {
        type: String,
        default: ''
    },
    baseUnit: {
        type: String,
        default: ''
    },
    unitPrice: {
        type: Number,
        default: null
    },
    category: {
        type: String,
        default: ''
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'pricesnapshots',
    timestamps: true
});

// Compound index: one product per chain (for fast lookup)
priceSnapshotSchema.index({ productName: 1, chainId: 1 }, { unique: true });

module.exports = mongoose.model('PriceSnapshot', priceSnapshotSchema);

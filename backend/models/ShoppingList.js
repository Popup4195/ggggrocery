const mongoose = require('mongoose');

// FR-S1: shareable shopping list (guest mode, no login required).
// We reuse Mongo's own _id as the shareable identifier (no separate UUID needed).
// Item shape mirrors the frontend's `items` state exactly (see App.jsx),
// so no transformation is needed on save/load.
const shoppingListItemSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    baseUnit: { type: String, default: '' },
    query: { type: String, default: '' },
    category: { type: String, default: null },
    confirmed: { type: Boolean, default: false }
}, { _id: false });

const shoppingListSchema = new mongoose.Schema({
    items: {
        type: [shoppingListItemSchema],
        default: []
    },
    // Selected supermarket chains + transport settings travel with the shared link
    // so the plan is reproducible for anyone who opens it. Location (userLat/userLng)
    // is intentionally NOT stored here — each viewer enters their own, since a plan
    // built around the sharer's location wouldn't be accurate for anyone else.
    selectedChains: {
        type: [String],
        default: []
    },
    transportMode: {
        type: String,
        enum: ['driving', 'walking'],
        default: 'driving'
    },
    fuelType: {
        type: String,
        default: '91'
    },
    walkingMaxKm: {
        type: Number,
        default: 2.0
    }
}, {
    timestamps: true // gives us createdAt / updatedAt automatically
});

module.exports = mongoose.model('ShoppingList', shoppingListSchema);
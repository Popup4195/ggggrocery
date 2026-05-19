// importing the necessary packages
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // the built in File System module to read Json files

// initials express app
const app = express();

// set up Middleware
app.use(cors()); // allows React app to make requests to the server
app.use(express.json()); // tells the server to understand imcoming json data

// creating the POST endpoint for Price Comparison
app.post('/api/compare', (req, res) =>{
    // req.body contains the data sent from the React frontend

    const { items, stores } = req.body;

    const results = [];
    const storeData = {};

    // read the requested json files
    stores.forEach(store => {
        try{
            // synchronously read the file
            const rawData = fs.readFileSync(`./${store}.json`, 'utf8');
            storeData[store] = JSON.parse(rawData);
        } catch (error) {
            console.error(`Error reading data fro ${store}:`, error);
            storeData[store] = {}; // falalback to an empty object if the file is missing
        }
    });

    // merge the data into a clean grid for frontend
    items.forEach(item => {
        // look up the item price. if it doesnt exitst. return null

        const row = { itemName: item };
    stores.foreEach(store => {
        if (storeData[store][item] !== undefined) {
            row[store] = storeData[store][item];
        } else {
            row[store] = null;
        }
    });
    results.push(row);
});

// send the final merged array back to frontend
res.json(results);
});

// start server
const PORT = 3000;
app. listen(PORT, () => {
    console.log(`Backend server is running at http://localhost:${PORT}`);

});


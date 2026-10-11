// Preloaded with `node -r` by dailyRefresh.test.js: replaces scraping, DB and env loading with offline stubs.
// Scenario comes from STUB_SCENARIO, e.g. "paknsave:0:403,403,403;newworld:5:200,200"
//   chainKey : product count : HTTP statuses the fake scrape "receives"
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const scraperDir = path.resolve(__dirname, '../../scripts/scraper');
const stubModule = (file, exports) => {
    const filename = path.join(scraperDir, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const scenario = {};
for (const part of (process.env.STUB_SCENARIO || '').split(';').filter(Boolean)) {
    const [chainKey, count, statuses] = part.split(':');
    scenario[chainKey] = { count: Number(count), statuses: statuses ? statuses.split(',').map(Number) : [] };
}

// fake HTTP: an adapter that never touches the network
const fakeAdapter = (status) => async (config) => {
    const response = { data: '', status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 200 && status < 300) return response;
    throw new axios.AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response);
};

stubModule('runBatch.js', {
    runBatchForChain: async (chainKey) => {
        const { count = 0, statuses = [] } = scenario[chainKey] || {};
        for (const status of statuses) {
            // like scrapeAllPages: a failed page is logged and swallowed, not thrown
            await axios.get('http://offline.invalid/', { adapter: fakeAdapter(status) }).catch(() => {});
        }
        return { chainKey, outFile: `${chainKey}-products.json`, count };
    },
});
stubModule('importToDb.js', { importFile: async () => ({ created: 0, updated: 0 }) });
stubModule('backfillUnitPrice.js', { backfillFile: async () => ({ updated: 0 }) });

// don't read .env.local, don't connect to MongoDB
require.cache[require.resolve('dotenv')] = {
    id: 'dotenv', filename: require.resolve('dotenv'), loaded: true, exports: { config: () => ({}) },
};
process.env.MONGODB_URI = 'mongodb://stub.invalid/test';
mongoose.connect = async () => {};
mongoose.disconnect = async () => {};

// skip the 2-5 minute wait between chains
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

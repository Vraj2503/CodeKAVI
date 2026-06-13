/**
 * index.js — JavaScript entry point for the sample fixture repo.
 *
 * Tests JS/TS import extraction (import/from, require).
 */

import { apiHandler } from './api';
const utils = require('./utils');

function startServer() {
    const app = apiHandler();
    app.listen(3000, () => {
        console.log('Server running on port 3000');
    });
}

startServer();

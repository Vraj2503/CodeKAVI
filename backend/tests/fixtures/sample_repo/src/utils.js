/**
 * utils.js — Shared JavaScript utility functions.
 *
 * A leaf utility imported by api.ts and index.js.
 * Tests: shared_utility role, high in-degree.
 */

function formatResponse(data) {
    return {
        success: true,
        timestamp: new Date().toISOString(),
        data: data,
    };
}

function validateId(id) {
    if (typeof id !== 'string' || id.length < 1) {
        throw new Error('Invalid ID');
    }
    return id.trim();
}

module.exports = { formatResponse, validateId };

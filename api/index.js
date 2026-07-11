// Vercel serverless entry point.
//
// Wraps the existing Express app from backend/server.js. Vercel routes every
// request matching /api/* (see vercel.json) to this function; the original URL
// (e.g. /api/ai/generate-launch-kit) is preserved, so the Express router
// matches its routes unchanged.
module.exports = require('../backend/server.js');

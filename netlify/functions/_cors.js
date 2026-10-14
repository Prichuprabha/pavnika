// netlify/functions/_cors.js
//
// Minimal CORS support, applied ONLY to the handful of read-only
// endpoints the offline Finance app (a standalone HTML file run from
// your own computer, never deployed to pavnika.ae) needs to call
// directly from outside the site's own origin. Every other function
// stays exactly as it was -- this is opt-in per function, not a
// blanket policy.
//
// Note on what this does and doesn't change: these endpoints already
// required a valid, short-lived signed adminToken in the request body
// to return anything -- that check is untouched. CORS only controls
// whether a BROWSER running JavaScript from another origin is allowed
// to read the response; it was never what stood between this data and
// a request made with curl/Postman/etc, since those were never
// subject to CORS in the first place. So this doesn't weaken the
// actual access control (the token still does that) -- it only lets
// the offline app's own browser-based fetch() calls succeed.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Call at the top of a handler, before anything else. Returns a
// response to return immediately on a preflight OPTIONS request, or
// null to continue handling the real request as normal.
function corsPreflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  return null;
}

module.exports = { CORS_HEADERS: CORS_HEADERS, corsPreflight: corsPreflight };

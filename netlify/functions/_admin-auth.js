// netlify/functions/_admin-auth.js
//
// Shared helper: issues and verifies short-lived signed tokens proving a
// request came from someone who successfully logged in with a real
// admin_users username/password (see admin-login.js). Every write-facing
// admin-*.js function checks verifyAdminToken(token) before doing
// anything — same pattern as _pos-auth.js's POS session tokens.

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — a working day

function getSecret() {
  var secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SECRET is not set');
  return secret;
}

function signAdminToken(userId, username, displayName) {
  var payload = JSON.stringify({
    userId: userId,
    username: username,
    displayName: displayName,
    exp: Date.now() + TOKEN_TTL_MS
  });
  var payloadB64 = Buffer.from(payload).toString('base64url');
  var sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + sig;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  var payloadB64 = parts[0];
  var sig = parts[1];
  var expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');

  var sigBuf = Buffer.from(sig || '');
  var expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  var payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch (e) {
    return null;
  }

  if (!payload.userId || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

module.exports = { signAdminToken: signAdminToken, verifyAdminToken: verifyAdminToken };

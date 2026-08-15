// netlify/functions/_visitor-auth.js
//
// Shared helper: issues and verifies signed tokens proving a request
// genuinely came from a browser that completed OTP verification as a
// given email — the same pattern _admin-auth.js already uses for the
// admin panel, just generalized to any verified visitor rather than
// one hardcoded email. This is what lets the cart/wishlist functions
// trust an email address without letting anyone just type in a
// stranger's email and read/edit their cart.
//
// Uses a SEPARATE secret from ADMIN_SECRET on purpose — a leaked
// visitor secret should never be usable to forge an admin token, and
// vice versa.

const crypto = require('crypto');

// Matches the visitor-facing "stay signed in" cookie, which is also
// 90 days (see gateSetCookie('pavnika_verified', ...) in script.js) —
// the token should stay valid for exactly as long as the cookie that
// carries it, since once the cookie expires the visitor gets asked to
// re-verify anyway.
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function getSecret() {
  var secret = process.env.VISITOR_SECRET;
  if (!secret) throw new Error('VISITOR_SECRET is not set');
  return secret;
}

function signVisitorToken(email) {
  var payload = JSON.stringify({ email: email, exp: Date.now() + TOKEN_TTL_MS });
  var payloadB64 = Buffer.from(payload).toString('base64url');
  var sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + sig;
}

// Returns { email, exp } if the token is genuine and not expired,
// otherwise null. Unlike verifyAdminToken, this accepts ANY email —
// any successfully-verified visitor is allowed a token for their own
// cart/wishlist, not just one hardcoded address.
function verifyVisitorToken(token) {
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

  if (!payload.email) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;

  return payload;
}

module.exports = { signVisitorToken: signVisitorToken, verifyVisitorToken: verifyVisitorToken };

// netlify/functions/_admin-auth.js
//
// Shared helper: issues and verifies short-lived signed tokens proving a
// request genuinely came from a session that completed OTP verification
// as the admin email. Prevents anyone from forging admin write requests
// just by knowing/guessing the admin email address.

const crypto = require('crypto');

const ADMIN_EMAIL = 'pavnikabysaranya@gmail.com';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getSecret() {
  var secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SECRET is not set');
  return secret;
}

function signAdminToken(email) {
  var payload = JSON.stringify({ email: email, exp: Date.now() + TOKEN_TTL_MS });
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

  if (!payload.email || payload.email !== ADMIN_EMAIL) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;

  return payload;
}

module.exports = { ADMIN_EMAIL: ADMIN_EMAIL, signAdminToken: signAdminToken, verifyAdminToken: verifyAdminToken };

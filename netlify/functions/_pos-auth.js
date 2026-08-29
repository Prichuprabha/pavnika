// netlify/functions/_pos-auth.js
//
// Shared helper for the POS system: hashes/verifies passwords for
// pos_users, and issues/verifies short-lived signed session tokens —
// same signing approach as _admin-auth.js, but identifying a specific
// POS user (for the "sales person" field) rather than the single
// hardcoded admin email.

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — a working shift

function getSecret() {
  var secret = process.env.ADMIN_SECRET; // reuse the same secret already configured for admin tokens
  if (!secret) throw new Error('ADMIN_SECRET is not set');
  return secret;
}

// Password hashing: Node's built-in scrypt, not bcrypt — bcrypt needs a
// native module, which can be awkward to install reliably in a
// serverless function; scrypt ships with Node itself and is considered
// equally secure for this purpose.
function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: hash, salt: salt };
}

function verifyPassword(password, hash, salt) {
  var candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
  var candidateBuf = Buffer.from(candidateHash);
  var hashBuf = Buffer.from(hash);
  if (candidateBuf.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, hashBuf);
}

function signPosToken(userId, username, displayName, isAdmin) {
  var payload = JSON.stringify({ userId: userId, username: username, displayName: displayName, isAdmin: !!isAdmin, exp: Date.now() + TOKEN_TTL_MS });
  var payloadB64 = Buffer.from(payload).toString('base64url');
  var sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + sig;
}

function verifyPosToken(token) {
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

module.exports = {
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  signPosToken: signPosToken,
  verifyPosToken: verifyPosToken
};

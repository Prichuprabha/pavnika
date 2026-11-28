// Signed, non-expiring token for the one-click "unsubscribe from offers"
// link in marketing emails. Signed with VISITOR_SECRET so nobody can
// unsubscribe (or probe) someone else's address by guessing a link.
const crypto = require('crypto');

function secret() {
  const s = process.env.VISITOR_SECRET;
  if (!s) throw new Error('VISITOR_SECRET is not set');
  return s;
}
function sign(email) {
  const e = Buffer.from(String(email).toLowerCase()).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update('unsub:' + e).digest('base64url');
  return e + '.' + sig;
}
// Returns the email, or null if the token isn't genuine.
function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update('unsub:' + parts[0]).digest('base64url');
  const a = Buffer.from(parts[1] || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return Buffer.from(parts[0], 'base64url').toString(); } catch (e) { return null; }
}
module.exports = { sign: sign, verify: verify };

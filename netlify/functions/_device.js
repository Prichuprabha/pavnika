// Shared helper: "trusted devices". A browser that has completed the
// 4-digit email code for an address is remembered (as a hash of a random
// per-browser id, never the raw id), so only a NEW browser/device has to
// verify again.
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}
function validId(id) { return typeof id === 'string' && /^[a-f0-9]{32}$/.test(id); }
function hashId(id) {
  return crypto.createHash('sha256').update((process.env.VISITOR_SECRET || '') + ':device:' + id).digest('hex');
}

// Fails closed: if the lookup can't be done (e.g. the table hasn't been
// created yet) the device is treated as NOT trusted and a code is asked.
async function isTrusted(email, deviceId) {
  if (!validId(deviceId)) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trusted_devices?email=eq.${encodeURIComponent(email)}&device_hash=eq.${hashId(deviceId)}&select=id`, { headers: headers() });
    if (!res.ok) { console.error('trusted_devices lookup failed:', res.status, await res.text()); return false; }
    const rows = await res.json();
    if (rows.length) {
      // best-effort "last seen"
      fetch(`${SUPABASE_URL}/rest/v1/trusted_devices?id=eq.${rows[0].id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ last_seen: new Date().toISOString() }) }).catch(function () {});
      return true;
    }
    return false;
  } catch (e) { console.error('trusted_devices lookup error:', e); return false; }
}

async function trust(email, deviceId) {
  if (!validId(deviceId)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trusted_devices?on_conflict=email,device_hash`, {
      method: 'POST',
      headers: Object.assign(headers(), { 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ email: email, device_hash: hashId(deviceId), last_seen: new Date().toISOString() })
    });
    if (!res.ok) console.error('trusted_devices save failed:', res.status, await res.text());
  } catch (e) { console.error('trusted_devices save error:', e); }
}

module.exports = { isTrusted: isTrusted, trust: trust, validId: validId };

// netlify/functions/trust-device.js
// POST { visitorToken, deviceId }
// A browser that already holds a valid signed-in token is remembered as a
// trusted device for that email. This is what keeps customers who were
// already signed in when device checks were introduced from being asked
// for a code again on the browser they were already using.
const { verifyVisitorToken } = require('./_visitor-auth');
const { trust, validId } = require('./_device');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }
  const who = verifyVisitorToken(body.visitorToken);
  if (!who) return { statusCode: 401, body: JSON.stringify({ error: 'Not verified or session expired.' }) };
  if (!validId(body.deviceId)) return { statusCode: 400, body: JSON.stringify({ error: 'Bad device id.' }) };
  await trust(String(who.email).toLowerCase(), body.deviceId);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

const { verifyPosToken } = require('./_pos-auth');
const { generateBillNumber } = require('./_pos-shared');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  var body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  try {
    var billNumber = await generateBillNumber();
    return { statusCode: 200, body: JSON.stringify({ billNumber: billNumber }) };
  } catch (e) {
    console.error('pos-peek-bill-number error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};

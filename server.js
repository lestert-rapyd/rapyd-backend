const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(express.json());

// CORS configuration: allow only your frontend origin
const allowedOrigins = ['https://rapydtoolkit.com'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (e.g., Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

// RAPYD CONFIG - Put your own keys in .env file
const ACCESS_KEY = process.env.RAPYD_ACCESS_KEY;
const SECRET_KEY = process.env.RAPYD_SECRET_KEY;
const RAPYD_BASE_URL = 'https://sandboxapi.rapyd.net'; // Use live URL in production

// Helper: Generate Rapyd HMAC signature
function generateSignature(httpMethod, urlPath, salt, timestamp, body, secretKey) {
  const bodyString = body ? JSON.stringify(body) : '';
  const toSign = `${httpMethod}${urlPath}${salt}${timestamp}${ACCESS_KEY}${SECRET_KEY}${bodyString}`;
  return crypto.createHash('sha256').update(toSign).digest('hex');
}

function getAuthHeaders(httpMethod, urlPath, body = null) {
  const salt = crypto.randomBytes(6).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = generateSignature(httpMethod, urlPath, salt, timestamp, body, SECRET_KEY);

  return {
    access_key: ACCESS_KEY,
    salt: salt,
    timestamp: timestamp,
    signature: signature,
    'Content-Type': 'application/json',
  };
}

// Endpoint: Create Direct Card Payment
app.post('/api/create-direct-payment', async (req, res) => {
  try {
    const { amount, currency, description, card } = req.body;

    const urlPath = '/v1/payments';
    const url = RAPYD_BASE_URL + urlPath;

    const body = {
      amount: parseFloat(amount).toFixed(2),
      currency,
      payment_method: {
        type: 'de_visa_card',
        fields: {
          number: card.number,
          expiration_month: card.expiration_month,
          expiration_year: card.expiration_year,
          cvv: card.cvv,
          name: card.name,
        },
      },
      capture: true,
      description,
    };

    const headers = getAuthHeaders('POST', urlPath, body);

    const response = await axios.post(url, body, { headers });

    res.json({
      status: response.data.status.status,
      data: response.data,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Payment failed', details: error.response?.data || error.message });
  }
});

// Endpoint: Create Hosted Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount, currency, description } = req.body;

    const urlPath = '/v1/checkout';
    const url = RAPYD_BASE_URL + urlPath;

    const body = {
      amount: parseFloat(amount).toFixed(2),
      currency,
      country: 'DE', // adjust if needed
      language: 'en',
      complete_checkout_url: 'https://example.com/success',
      error_checkout_url: 'https://example.com/error',
      checkout_reference_id: 'order_12345',
      metadata: { description },
    };

    const headers = getAuthHeaders('POST', urlPath, body);

    const response = await axios.post(url, body, { headers });

    if (response.data && response.data.data) {
      res.json({
        redirect_url: response.data.data.redirect_url,
        checkout_id: response.data.data.id,
      });
    } else {
      res.status(500).json({ error: 'No data returned from Rapyd' });
    }
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Checkout session creation failed', details: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rapyd backend listening on port ${PORT}`);
});

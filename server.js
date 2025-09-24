const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

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

// Endpoint: Create Direct Card Payment (/api/create-direct-payment)
app.post('/api/create-direct-payment', async (req, res) => {
  try {
    const { amount, currency, description, card } = req.body;

    const urlPath = '/v1/payments';
    const url = RAPYD_BASE_URL + urlPath;

    const body = {
      amount: parseFloat(amount).toFixed(2),
      currency,
      payment_method: {
        type: 'us_debit_visa_card', // or other card types as needed
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

// Endpoint: Create Hosted Checkout Session (/api/create-checkout-session)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount, currency, description } = req.body;

    const urlPath = '/v1/checkout';
    const url = RAPYD_BASE_URL + urlPath;

    const body = {
      amount: parseFloat(amount).toFixed(2),
      currency,
      country: 'US',  // Adjust as needed
      language: 'en',
      complete_checkout_url: 'https://your-frontend-domain.com/success',  // Replace with your frontend success URL
      error_checkout_url: 'https://your-frontend-domain.com/error',       // Replace with your frontend error URL
      checkout_reference_id: 'order_12345',                               // Replace with your order ID or generate dynamically
      metadata: { description },
    };

    const headers = getAuthHeaders('POST', urlPath, body);

    const response = await axios.post(url, body, { headers });

    if (response.data && response.data.data && response.data.data.redirect_url) {
      res.json({ redirect_url: response.data.data.redirect_url });
    } else {
      res.status(500).json({ error: 'No redirect URL returned from Rapyd' });
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

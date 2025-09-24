import crypto from "crypto";

const RAPYD_ACCESS_KEY = process.env.RAPYD_ACCESS_KEY;
const RAPYD_SECRET_KEY = process.env.RAPYD_SECRET_KEY;
const RAPYD_BASE_URL = "https://sandboxapi.rapyd.net"; // or production url if live

function generateRapydSignature(httpMethod, urlPath, body, salt, timestamp, accessKey, secretKey) {
  const bodyString = body ? JSON.stringify(body) : "";
  const toSign = httpMethod + urlPath + salt + timestamp + accessKey + secretKey + bodyString;
  const signature = crypto.createHash("sha256").update(toSign).digest("base64");
  return signature;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Build the Rapyd API request to create a checkout session
    const path = "/v1/checkout";
    const url = RAPYD_BASE_URL + path;

    // Example checkout session payload — adjust as needed
    const body = {
      amount: 19.99,
      currency: "USD",
      country: "DE",
      // Add your additional parameters here as per Rapyd docs
      complete_payment_url: "http://example.com/success",
      cancel_payment_url: "http://example.com/cancel",
    };

    const salt = crypto.randomBytes(6).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const signature = generateRapydSignature(
      "post",
      path,
      body,
      salt,
      timestamp,
      RAPYD_ACCESS_KEY,
      RAPYD_SECRET_KEY
    );

    const headers = {
      "Content-Type": "application/json",
      "access_key": RAPYD_ACCESS_KEY,
      "salt": salt,
      "timestamp": timestamp,
      "signature": signature,
    };

    // Call Rapyd API
    const rapydResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!rapydResponse.ok) {
      const errorText = await rapydResponse.text();
      return res.status(rapydResponse.status).json({ error: errorText });
    }

    const data = await rapydResponse.json();

    // Return the Rapyd response back to frontend
    res.status(200).json(data);
  } catch (error) {
    console.error("Error in create-checkout-session:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

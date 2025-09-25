// api/create-checkout-session.js
import axios from "axios";
import crypto from "crypto";

function generateRapydSignature(method, urlPath, body) {
  const access_key = process.env.RAPYD_ACCESS_KEY;
  const secret_key = process.env.RAPYD_SECRET_KEY;

  const salt = crypto.randomBytes(8).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = body ? JSON.stringify(body) : "";

  const toSign = method.toLowerCase() + urlPath + salt + timestamp + access_key + secret_key + bodyString;

  const signature = crypto.createHmac("sha256", secret_key).update(toSign).digest("base64");

  console.log("---- Rapyd Signature Debug ----");
  console.log("String to sign:", toSign);
  console.log("Access Key:", access_key);
  console.log("Salt:", salt);
  console.log("Timestamp:", timestamp);
  console.log("Signature:", signature);
  console.log("-------------------------------");

  return { salt, timestamp, signature };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    // Handle CORS preflight
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;

    if (!process.env.RAPYD_ACCESS_KEY || !process.env.RAPYD_SECRET_KEY) {
      console.error("Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY environment variables");
      return res.status(500).json({ error: "Server configuration error: Missing API keys" });
    }

    const { salt, timestamp, signature } = generateRapydSignature("post", "/v1/checkout", body);

    const rapydRes = await axios.post("https://sandboxapi.rapyd.net/v1/checkout", body, {
      headers: {
        "Content-Type": "application/json",
        access_key: process.env.RAPYD_ACCESS_KEY,
        salt,
        timestamp,
        signature,
      },
      timeout: 10000,
    });

    res.setHeader("Access-Control-Allow-Origin", "*");

    console.log("Rapyd response data:", rapydRes.data);

    // Return the full Rapyd response so frontend can debug too
    return res.status(200).json(rapydRes.data);

  } catch (err) {
    // Log full error details for debugging
    console.error("Error calling Rapyd /v1/checkout:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Headers:", err.response.headers);
      console.error("Data:", err.response.data);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(err.response.status || 500).json({
        error: err.response.data || "Unknown error",
      });
    } else {
      console.error(err.message);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(500).json({ error: err.message });
    }
  }
}

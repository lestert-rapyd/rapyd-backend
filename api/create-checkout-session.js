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
  return { salt, timestamp, signature };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
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
    const { salt, timestamp, signature } = generateRapydSignature("post", "/v1/checkout", body);

    const rapydRes = await axios.post("https://sandboxapi.rapyd.net/v1/checkout", body, {
      headers: {
        "Content-Type": "application/json",
        access_key: process.env.RAPYD_ACCESS_KEY,
        salt,
        timestamp,
        signature,
      }
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(rapydRes.data.data);
  } catch (err) {
    console.error("Error calling Rapyd /v1/checkout:", err.response?.data || err.message);

    // Return full Rapyd error details back to frontend
    const errorData = err.response?.data || { message: err.message };
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: errorData });
  }
}

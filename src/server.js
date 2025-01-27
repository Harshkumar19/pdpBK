import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { decryptRequest, encryptResponse } from "./encryption.js";
import { getNextScreen } from "./flow.js";
import pkg from "pg";
const { Pool } = pkg;

dotenv.config();

const app = express();
const {
  APP_SECRET,
  PRIVATE_KEY,
  PASSPHRASE,
  PORT = "3000",
  DATABASE_URL,
} = process.env;

// Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Create appointments table if it doesn't exist
const createAppointmentsTable = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      appointment_type VARCHAR(50),
      gender VARCHAR(10),
      appointment_date DATE,
      appointment_time VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(createTableQuery);
};

// Call the function to create the table
createAppointmentsTable()
  .then(() => console.log("Appointments table is ready"))
  .catch((err) => console.error("Error creating appointments table:", err));

// Middleware for parsing JSON and capturing raw body
app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || "utf8");
    },
  })
);

// Request Signature Validation
function isRequestSignatureValid(req) {
  if (!APP_SECRET) {
    console.warn("App Secret is not set up. Skipping signature validation.");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader) {
    console.warn("Missing x-hub-signature-256 header.");
    return false;
  }

  const signatureBuffer = Buffer.from(
    signatureHeader.replace("sha256=", ""),
    "utf-8"
  );

  const hmac = crypto.createHmac("sha256", APP_SECRET);
  const digestString = hmac.update(req.rawBody).digest("hex");
  const digestBuffer = Buffer.from(digestString, "utf-8");

  return crypto.timingSafeEqual(digestBuffer, signatureBuffer);
}

// Endpoint to handle appointments
app.post("/appointments", async (req, res) => {
  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(
      req.body,
      PRIVATE_KEY,
      PASSPHRASE
    );

    const response = await getNextScreen(decryptedBody);
    const encryptedResponse = encryptResponse(
      response,
      aesKeyBuffer,
      initialVectorBuffer
    );

    // Save appointment data to PostgreSQL
    if (
      decryptedBody.action === "data_exchange" &&
      decryptedBody.screen === "SCHEDULE"
    ) {
      const appointmentData = {
        appointment_type: decryptedBody.data.appointment_type,
        gender: decryptedBody.data.gender,
        appointment_date: decryptedBody.data.appointment_date,
        appointment_time: decryptedBody.data.appointment_time,
        notes: decryptedBody.data.notes || "No additional notes provided.",
      };

      await pool.query(
        "INSERT INTO appointments (appointment_type, gender, appointment_date, appointment_time, notes) VALUES ($1, $2, $3, $4, $5)",
        [
          appointmentData.appointment_type,
          appointmentData.gender,
          appointmentData.appointment_date,
          appointmentData.appointment_time,
          appointmentData.notes,
        ]
      );

      console.log("Appointment saved to PostgreSQL:", appointmentData);
    }

    res.json({ encrypted_response: encryptedResponse });
  } catch (error) {
    console.error("Error processing appointment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint to get all appointments
app.get("/appointments", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM appointments");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Main WhatsApp Flow endpoint
app.post("/", async (req, res) => {
  if (!PRIVATE_KEY) {
    return res.status(500).send("Private key is missing");
  }

  if (!isRequestSignatureValid(req)) {
    return res.status(432).send();
  }

  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(
      req.body,
      PRIVATE_KEY,
      PASSPHRASE
    );

    const response = await getNextScreen(decryptedBody);
    const encryptedResponse = encryptResponse(
      response,
      aesKeyBuffer,
      initialVectorBuffer
    );

    res.json({ encrypted_response: encryptedResponse });
  } catch (error) {
    console.error("Processing error:", error);
    if (error.statusCode) {
      return res.status(error.statusCode).send();
    }
    return res.status(500).send();
  }
});

// Health check endpoint
app.post("/health", async (req, res) => {
  const { action } = req.body;

  // Check if the action is "ping"
  if (action !== "ping") {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    await pool.query("SELECT 1"); // Simple query to check connection
    res.json({ data: { status: "active" } });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({ status: "unhealthy", error: error.message });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("WhatsApp Flow Appointment Booking Service - Running");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

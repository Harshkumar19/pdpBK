require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./models/db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("Server is running and connected to the database!");
});

// Check database connection
pool
  .connect()
  .then(() => console.log("Connected to PostgreSQL database"))
  .catch((err) => console.error("Connection error", err.stack));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Basic Setup
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = process.env.MONGO_URI;

// MongoClient Setup
const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    // Connect to DB
    await client.connect();
    console.log("✅ MongoDB Connected");

    // Database & Collection
    const db = client.db("surplusShareDB");
    const donationCollection = db.collection("donations");

    
    

    // 🟡 Root Route
    app.get("/", (req, res) => {
      res.send("🚀 SurplusShare API is Running (MongoDB Native)");
    });

  } catch (error) {
    console.error("❌ Server error:", error);
  }
}

run().catch(console.dir);

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});

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
    const userCollection = db.collection("users");


    // ✅ POST /api/users
    app.post("/users", async (req, res) => {
      const { name, email, photoURL, role } = req.body;

      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }

      const filter = { email };
      const update = {
        $setOnInsert: {
          name,
          photoURL,
          role: role || "user",
        },
        $set: {
          lastLoginAt: new Date().toISOString(),
        },
      };

      const options = { upsert: true };
      const result = await userCollection.updateOne(filter, update, options);
      res.send(result);
    });

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

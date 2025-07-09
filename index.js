// Basic Setup
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const donationsCollection = db.collection("donations");
    const favoritesCollection = db.collection("favorites");
    const donationRequestsCollection = db.collection("donationReq");
    const reviewsCollection = db.collection("reviews");


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
    // *************************************all donation collection api*****************************************//
    // get the all donations data
    app.get("/donations", async (req, res) => {
      const result = await donationsCollection.find().toArray();
      res.send(result);
    });
    // get single donation data
    app.get("/donations/:id", async (req, res) => {
      const id = req.params.id;
      const result = await donationsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // post favorites donation
    app.post("/favorites", async (req, res) => {
      const { donationId, userEmail } = req.body;
      console.log(donationId, userEmail);

      if (!donationId || !userEmail) {
        return res.status(400).send({ error: "Missing data" });
      }

      const existing = await favoritesCollection.findOne({
        donationId,
        userEmail,
      });
      if (existing) {
        return res.status(409).send({ message: "Already added" });
      }

      const doc = {
        donationId,
        userEmail,
        addedAt: new Date().toISOString(),
      };

      const result = await favoritesCollection.insertOne(doc);
      res.send(result);
    });

    // request for donation
    app.post("/donation-requests", async (req, res) => {
      const { donationId, pickupTime, description, charityName, charityEmail } =
        req.body;

      if (
        !donationId ||
        !pickupTime ||
        !description ||
        !charityName ||
        !charityEmail
      ) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      const request = {
        donationId: new ObjectId(donationId),
        pickupTime,
        description,
        charityName,
        charityEmail,
        status: "Pending",
        requestedAt: new Date(),
      };

      const requestResult = await donationRequestsCollection.insertOne(request);

      await donationsCollection.updateOne(
        { _id: new ObjectId(donationId) },
        { $set: { status: "Requested", charityName } }
      );

      res.send(requestResult);
    });


app.post("/donations/:id/reviews", async (req, res) => {
  const { id } = req.params;
  const { reviewer, description, rating } = req.body;

  if (!reviewer || !description || !rating) {
    return res.status(400).send({ error: "Missing fields" });
  }

  const review = {
    donationId: new ObjectId(id),
    reviewer,
    description,
    rating: parseInt(rating),
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await reviewsCollection.insertOne(review);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to save review", details: err.message });
  }
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

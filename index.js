// ✅ Basic Setup
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());



var serviceAccount = require("./surplusshare-bd-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// ✅ Middleware function to verify Firebase ID token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ error: "Unauthorized access (no token)" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // attach user info to req
    next();
  } catch (error) {
    console.error("❌ Token verification failed:", error.message);
    res.status(401).send({ error: "Unauthorized (invalid token)" });
  }
};

// ✅ MongoDB URI & Client Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected");

    // ✅ DB & Collections
    const db = client.db("surplusShareDB");
    const userCollection = db.collection("users");
    const donationsCollection = db.collection("donations");
    const favoritesCollection = db.collection("favorites");
    const donationRequestsCollection = db.collection("donationReq");
    const reviewsCollection = db.collection("reviews");

    // ✅ Save or update user on login/register
    app.post("/users",verifyToken, async (req, res) => {
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

    // ✅ GET: All donations
    app.get("/donations", verifyToken, async (req, res) => {
      const result = await donationsCollection.find().toArray();
      res.send(result);
    });

    // ✅ GET: Single donation by ID
    app.get("/donations/:id",verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await donationsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ✅ POST: Add to favorites (check if already exists)
    app.post("/favorites",verifyToken, async (req, res) => {
      const { donationId, userEmail } = req.body;

      if (!donationId || !userEmail) {
        return res.status(400).send({ error: "Missing data" });
      }

      const existing = await favoritesCollection.findOne({
        donationId,
        userEmail,
      });

      if (existing) {
        return res.status(409).send({ message: "Already in favorites" });
      }

      const doc = {
        donationId,
        userEmail,
        addedAt: new Date().toISOString(),
      };

      const result = await favoritesCollection.insertOne(doc);
      res.send(result);
    });

    // ✅ POST: Request for a donation (prevent duplicate requests)
    app.post("/donation-requests",verifyToken, async (req, res) => {
      const { donationId, pickupTime, description, charityName, charityEmail } = req.body;

      if (!donationId || !pickupTime || !description || !charityName || !charityEmail) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      // ❌ Check if request already exists for same donation and user
      const existingRequest = await donationRequestsCollection.findOne({
        donationId: new ObjectId(donationId),
        charityEmail,
      });

      if (existingRequest) {
        return res.status(409).send({ message: "Already requested this donation" });
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

      // Update donation status
      await donationsCollection.updateOne(
        { _id: new ObjectId(donationId) },
        { $set: { status: "Requested", charityName } }
      );

      res.send(requestResult);
    });

    // ✅ POST: Submit a review (prevent duplicate review per user & donation)
    app.post("/donations/:id/reviews",verifyToken, async (req, res) => {
      const { id } = req.params;
      const { reviewer, description, rating } = req.body;

      if (!reviewer || !description || !rating) {
        return res.status(400).send({ error: "Missing fields" });
      }

      // ❌ Check if user already reviewed
      const existingReview = await reviewsCollection.findOne({
        donationId: new ObjectId(id),
        reviewer,
      });

      if (existingReview) {
        return res.status(409).send({ message: "You already reviewed this donation" });
      }

      const review = {
        donationId: new ObjectId(id),
        reviewer,
        description,
        rating: parseInt(rating),
        createdAt: new Date().toISOString(),
      };

      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // ✅ Root route (health check)
    app.get("/", (req, res) => {
      res.send("🚀 SurplusShare API is Running (MongoDB Native)");
    });

  } catch (error) {
    console.error("❌ Server error:", error);
  }
}

run().catch(console.dir);

// ✅ Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});

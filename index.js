// ✅ Basic Setup
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());

var serviceAccount = require("./surplusshare-bd-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
    const charityRoleReqCollection = db.collection("charityRoleRequests");
    const transactionsCollection = db.collection("transactions");

    // ✅ Save or update user on login/register
    app.post("/users", verifyToken, async (req, res) => {
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

    // ✅ GET: user info use user gmail
    // GET /users/:email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(user);
    });

    // ✅ GET: All donations
    app.get("/donations", verifyToken, async (req, res) => {
      const result = await donationsCollection.find().toArray();
      res.send(result);
    });

    // ✅ GET: Single donation by ID
    app.get("/donations/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await donationsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ✅ POST: Add to favorites (check if already exists)
    app.post("/favorites", verifyToken, async (req, res) => {
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
    app.post("/donation-requests", verifyToken, async (req, res) => {
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

      // ❌ Check if request already exists for same donation and user
      const existingRequest = await donationRequestsCollection.findOne({
        donationId: new ObjectId(donationId),
        charityEmail,
      });

      if (existingRequest) {
        return res
          .status(409)
          .send({ message: "Already requested this donation" });
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
    app.post("/donations/:id/reviews", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { rating, description, reviewerName, reviewerInfo } = req.body;

      if (!reviewerName || !description || !rating) {
        return res.status(400).send({ error: "Missing fields" });
      }

      // ❌ Check if user already reviewed
      const existingReview = await reviewsCollection.findOne({
        donationId: new ObjectId(id),
        reviewerName,
      });

      if (existingReview) {
        return res
          .status(409)
          .send({ message: "You already reviewed this donation" });
      }

      const review = {
        donationId: new ObjectId(id),
        reviewerInfo,
        reviewerName,
        description,
        rating: parseInt(rating),
        createdAt: new Date().toISOString(),
      };

      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });
    /***********************************Charity role*****************************************************/
    // get the charity role by email
    app.get("/charity-role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await charityRoleReqCollection.findOne({ email });
      res.send(result || {});
    });

    // Post charite role request
    app.post("/charity-role-requests", async (req, res) => {
      const { email, name, organization, mission, transactionId } = req.body;

      if (!email || !organization || !mission || !transactionId) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      const existing = await db
        .collection("charityRoleRequests")
        .findOne({ email });
      if (existing && ["pending", "approved"].includes(existing.status)) {
        return res.status(409).send({ message: "Request already exists" });
      }

      const doc = {
        email,
        name,
        organization,
        mission,
        transactionId,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };

      const result = await charityRoleReqCollection.insertOne(doc);
      res.send(result);
    });

    /*****************************payment************************************/

    // post charity payment transactions
    app.post("/transactions", async (req, res) => {
      const { email, amount, transactionId, purpose } = req.body;

      if (!email || !transactionId || !amount || !purpose) {
        return res.status(400).send({ error: "Missing transaction data" });
      }

      const doc = {
        email,
        amount,
        transactionId,
        purpose,
        date: new Date(),
      };

      const result = await db.collection("transactions").insertOne(doc);
      res.send(result);
    });

    // get charity payment transactions

    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100, // Stripe needs amount in cents
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/transactions/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const result = await transactionsCollection
          .find({ email })
          .sort({ createdAt: -1 }) // newest first
          .toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch transactions", error });
      }
    });

    /******************************************Favorites**********************************************/
    app.get("/favorites/:email", async (req, res) => {
      const { email } = req.params;

      try {
        const favorites = await favoritesCollection
          .aggregate([
            {
              $match: { userEmail: email },
            },
            // 🧠 Convert string donationId → ObjectId
            {
              $addFields: {
                donationId: { $toObjectId: "$donationId" },
              },
            },
            // 🔗 Join with donations collection
            {
              $lookup: {
                from: "donations",
                localField: "donationId",
                foreignField: "_id",
                as: "donation",
              },
            },
            // 🧼 Flatten the joined donation array
            {
              $unwind: "$donation",
            },
          ])
          .toArray();

        res.send(favorites);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch favorites", details: error.message });
      }
    });

    // DELETE /favorites/:id
    app.delete("/favorites/:id", async (req, res) => {
      const id = req.params.id;
      const result = await favoritesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // GET /reviews/user/:email**************************************************************************
    app.get("/reviews/user/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const reviews = await reviewsCollection
          .find({ "reviewerInfo.email": email })
          .toArray();

        // Join with donation collection
        const donationIds = reviews.map((r) => new ObjectId(r.donationId));
        const donations = await donationsCollection
          .find({ _id: { $in: donationIds } })
          .toArray();

        const donationsMap = donations.reduce((acc, donation) => {
          acc[donation._id.toString()] = donation;
          return acc;
        }, {});

        const enrichedReviews = reviews.map((review) => ({
          ...review,
          donation: donationsMap[review.donationId] || {},
        }));

        res.send(enrichedReviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews", error });
      }
    });

    // DELETE /reviews/:id
    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ✅ Root route (health check)*******************************************************************************
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

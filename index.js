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
      const { name, email, photoURL, role, firebaseUID } = req.body;

      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }

      const filter = { email };
      const update = {
        $setOnInsert: {
          name,
          photoURL,
          role: role || "user",
          firebaseUID,
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

      // Find the donation by ID to get its title
      const donation = await donationsCollection.findOne({
        _id: new ObjectId(donationId),
      });

      if (!donation) {
        return res.status(404).send({ error: "Donation not found" });
      }

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
        donationTitle: donation.title,
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
        status: "success",
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

    /**************************************Restorent role****************************************************/

    app.post("/donations", async (req, res) => {
      try {
        const donation = req.body;

        // Basic validation
        const requiredFields = [
          "title",
          "description",
          "imageUrl",
          "restaurantName",
          "restaurantEmail",
          "location",
          "quantity",
          "pickupTime",
        ];
        const missing = requiredFields.filter((f) => !donation[f]);
        if (missing.length > 0) {
          return res
            .status(400)
            .send({ message: `Missing fields: ${missing.join(", ")}` });
        }

        donation.status = "Pending";
        donation.createdAt = new Date().toISOString();

        const result = await donationsCollection.insertOne(donation);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to add donation", error });
      }
    });

    // get my donations

    app.get("/my-donations", async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { restaurantEmail: email } : {};
        const result = await donationsCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch donations", error: err });
      }
    });

    // update my donation
    app.patch("/my-donations/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = { ...req.body };
      delete updateData._id;
      try {
        const result = await donationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Donation updated successfully" });
        } else {
          res.send({ success: false, message: "No fields were updated" });
        }
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Update failed",
          error: error.message,
        });
      }
    });

    // delete my donation

    app.delete("/donations/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await donationsCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Donation deleted" });
        } else {
          res
            .status(404)
            .send({ success: false, message: "Donation not found" });
        }
      } catch (err) {
        res
          .status(500)
          .send({ success: false, message: "Delete failed", error: err });
      }
    });

    app.get("/charity-requests", async (req, res) => {
      try {
        const restaurantEmail = req.query.restaurantEmail;
        console.log("restaurantEmail:", restaurantEmail);

        // Step 1: Get all donations from this restaurant
        const donations = await donationsCollection
          .find({ restaurantEmail })
          .toArray();

        if (!donations.length) {
          return res.send([]); // No donations found
        }

        // Step 2: Extract all donation _ids as ObjectIds
        const donationIds = donations.map((d) => new ObjectId(d._id));

        // Step 3: Aggregate matching charity requests + lookup donation
        const requests = await donationRequestsCollection
          .aggregate([
            {
              $match: {
                donationId: { $in: donationIds },
              },
            },
            {
              $lookup: {
                from: "donations",
                localField: "donationId",
                foreignField: "_id",
                as: "donation",
              },
            },
            { $unwind: "$donation" },

            // ✅ Step 4: Sort by `requestedAt` field (oldest first)
            {
              $sort: {
                requestedAt: 1, // Ascending: 1 = oldest first, -1 = newest first
              },
            },
          ])
          .toArray();

        res.send(requests);
      } catch (error) {
        console.error("Error fetching charity requests:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // donation request accept and reject
    app.patch("/donation-requests/status/:id", async (req, res) => {
      try {
        const requestId = req.params.id;
        const { status } = req.body;

        if (!["Accepted", "Rejected"].includes(status)) {
          return res.status(400).send({ error: "Invalid status" });
        }

        const currentRequest = await donationRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });

        if (!currentRequest) {
          return res.status(404).send({ error: "Request not found" });
        }

        // Step 1: Update the selected request's status
        await donationRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status } }
        );

        // Step 2: If accepted, reject all others for the same donation
        if (status === "Accepted") {
          await donationRequestsCollection.updateMany(
            {
              donationId: currentRequest.donationId,
              _id: { $ne: new ObjectId(requestId) },
            },
            { $set: { status: "Rejected" } }
          );
        }

        res.send({ message: `Request ${status.toLowerCase()} successfully.` });
      } catch (error) {
        console.error("Status change error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    /**********************************Charity role***********************************************************************/

    // GET /charity-requests/user/:email
    app.get("/charity-requests/user/:email", async (req, res) => {
      const email = req.params.email;
      console.log("user email: ", email);
      const result = await charityRoleReqCollection.findOne({ email });
      res.send(result || {});
    });

    app.get("/donation-requests/by-charity/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const requests = await donationRequestsCollection
          .aggregate([
            {
              $match: { charityEmail: email },
            },
            {
              $addFields: {
                donationId: { $toObjectId: "$donationId" }, // Ensure ObjectId for lookup
              },
            },
            {
              $lookup: {
                from: "donations",
                localField: "donationId",
                foreignField: "_id",
                as: "donation",
              },
            },
            {
              $unwind: "$donation",
            },
            {
              $project: {
                _id: 1,
                status: 1,
                pickupTime: 1,
                description: 1,
                requestedAt: 1,
                donationTitle: "$donation.title",
                restaurantName: "$donation.restaurantName",
                foodType: "$donation.foodType",
                quantity: "$donation.quantity",
              },
            },
          ])
          .toArray();

        res.send(requests);
      } catch (err) {
        res.status(500).send({
          error: "Failed to fetch donation requests",
          message: err.message,
        });
      }
    });

    // delete donation request
    app.delete("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const request = await donationRequestsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!request) {
          return res.status(404).send({ error: "Request not found" });
        }

        if (request.status !== "Pending") {
          return res
            .status(400)
            .send({ error: "Only pending requests can be canceled" });
        }

        // Delete the request
        const result = await donationRequestsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        // Optionally update the donation status back to Available
        await donationsCollection.updateOne(
          { _id: new ObjectId(request.donationId) },
          { $set: { status: "Available" }, $unset: { charityName: "" } }
        );

        res.send({ message: "Request cancelled", result });
      } catch (err) {
        res
          .status(500)
          .send({ error: "Failed to cancel request", message: err.message });
      }
    });

    // get the donation request pickups
    app.get("/donation-requests/pickups/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const pickups = await donationRequestsCollection
          .aggregate([
            {
              $match: {
                charityEmail: email,
                status: "Accepted",
              },
            },
            {
              $addFields: {
                donationId: { $toObjectId: "$donationId" },
              },
            },
            {
              $lookup: {
                from: "donations",
                localField: "donationId",
                foreignField: "_id",
                as: "donation",
              },
            },
            {
              $unwind: "$donation",
            },
            {
              $project: {
                _id: 1,
                status: 1,
                pickupTime: 1,
                donationTitle: "$donation.title",
                foodType: "$donation.foodType",
                restaurantName: "$donation.restaurantName",
                quantity: "$donation.quantity",
                location: "$donation.location",
              },
            },
          ])
          .toArray();

        res.send(pickups);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch pickups", message: error.message });
      }
    });

    // change the status to confirm pickup
    app.patch("/donation-requests/confirm-pickup/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const request = await donationRequestsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!request) {
          return res.status(404).send({ error: "Request not found" });
        }

        if (request.status !== "Accepted") {
          return res
            .status(400)
            .send({ error: "Only accepted requests can be confirmed" });
        }

        // ✅ Update request status
        await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Picked Up" } }
        );

        // ✅ Also update donation status
        await donationsCollection.updateOne(
          { _id: new ObjectId(request.donationId) },
          { $set: { status: "Picked Up" } }
        );

        res.send({ message: "Pickup confirmed" });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to confirm pickup", message: error.message });
      }
    });

    // get donation request received
    app.get("/donation-requests/received/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const donations = await donationRequestsCollection
          .aggregate([
            {
              $match: {
                charityEmail: email,
                status: "Picked Up",
              },
            },
            {
              $addFields: {
                donationId: { $toObjectId: "$donationId" },
              },
            },
            {
              $lookup: {
                from: "donations",
                localField: "donationId",
                foreignField: "_id",
                as: "donation",
              },
            },
            { $unwind: "$donation" },
            {
              $project: {
                _id: 1,
                donationId: 1,
                donationTitle: "$donation.title",
                restaurantName: "$donation.restaurantName",
                foodType: "$donation.foodType",
                quantity: "$donation.quantity",
                pickupTime: "$pickupTime",
              },
            },
          ])
          .toArray();

        res.send(donations);
      } catch (error) {
        res.status(500).send({
          error: "Failed to load received donations",
          message: error.message,
        });
      }
    });

    // post donations reviews
    app.post("/donations/:id/reviews", async (req, res) => {
      const { id } = req.params;
      const { reviewer, description, rating } = req.body;

      if (!reviewer || !description || !rating) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      const review = {
        donationId: new ObjectId(id),
        reviewer, // { name, email, photoURL }
        description,
        rating: parseInt(rating),
        createdAt: new Date().toISOString(),
      };

      try {
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: "Failed to save review", message: err.message });
      }
    });

    /**************admin role*****************/
    // get al donations admin
    app.get("/admin/donations", async (req, res) => {
      try {
        const result = await donationsCollection.find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to load donations" });
      }
    });

    // update status
    app.patch("/admin/donations/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!["Verified", "Rejected"].includes(status)) {
        return res.status(400).send({ error: "Invalid status" });
      }

      const result = await donationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });

    // get all user
    app.get("/admin/users", async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    // update user role
    app.patch("/admin/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!["admin", "restaurant", "charity", "user"].includes(role)) {
        return res.status(400).send({ error: "Invalid role" });
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update role" });
      }
    });
    // delete user form mongodb and firebase
    app.delete("/admin/users/:id", async (req, res) => {
      const id = req.params.id;
      const { firebaseUID } = req.query;

      try {
        // 1. Delete from MongoDB
        const mongoResult = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });

        // 2. Delete from Firebase Auth
        if (firebaseUID) {
          await admin.auth().deleteUser(firebaseUID);
        }

        res.send({ success: true, mongoDeleted: mongoResult.deletedCount });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({ error: "Failed to delete user" });
      }
    });
    // get charity role request
    app.get("/admin/charity-role-requests", async (req, res) => {
      try {
        const requests = await charityRoleReqCollection.find().toArray();
        res.send(requests);
      } catch (error) {
        console.error("Failed to fetch charity role requests:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // update charity req accept or reject
    app.patch("/admin/charity-role-requests/:id", async (req, res) => {
      const { id } = req.params;
      const { email, status } = req.body;
      console.log("backend data : ", email, status);

      try {
        // 1. Update the status of the role request
        const updateRequest = await charityRoleReqCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        // 2. If approved, update user's role to "charity"
        let updateUser = null;
        if (status === "Approved") {
          updateUser = await userCollection.updateOne(
            { email },
            { $set: { role: "charity" } }
          );
        }

        res.send({
          success: true,
          updatedRequest: updateRequest.modifiedCount,
          updatedUser: updateUser?.modifiedCount || 0,
        });
      } catch (error) {
        console.error("Failed to update role request:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // delete charity request
    app.delete("/admin/charity-role-requests/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const result = await charityRoleReqCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Failed to delete role request:", error);
        res.status(500).send({ error: "Failed to delete role request" });
      }
    });

    // get  donations Requests
app.get("/admin/charity-donation-requests", async (req, res) => {
  try {
    const requests = await donationRequestsCollection.find().toArray();
    res.send(requests);
  } catch (error) {
    console.error("Failed to fetch donation requests:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

// delete charity donation request 
app.delete("/admin/charity-donation-requests/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await donationRequestsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ error: "Request not found" });
    }

    res.send({ success: true, deletedId: id });
  } catch (error) {
    console.error("Failed to delete donation request:", error);
    res.status(500).send({ error: "Internal server error" });
  }
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

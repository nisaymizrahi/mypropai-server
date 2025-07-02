require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const passport = require("passport");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const connectDB = require("./config/db");
const investmentRoutes = require("./routes/investments"); // ✅ NEW IMPORT
require("./config/passport");

const app = express();
connectDB();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Routes
app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/api/auth/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login" }),
  (req, res) => {
    const token = jwt.sign({ userId: req.user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.redirect(`http://localhost:3000/dashboard?token=${token}`);
  }
);

// ✅ Register new investment routes
app.use("/api/investments", investmentRoutes);

// ---------------------- ATTOM Comps Logic ---------------------- //
const API_KEY = process.env.ATTOM_API_KEY;

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fetchPropertyDetails = async (attomId) => {
  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?id=${attomId}`;
    const res = await axios.get(url, {
      headers: { accept: "application/json", apikey: API_KEY },
      timeout: 5000,
    });
    const p = res.data.property?.[0];
    return {
      beds: p?.building?.rooms?.beds ?? 0,
      baths: p?.building?.rooms?.bathstotal ?? 0,
      lotSize: p?.lot?.lotsize2 ?? 0,
      yearBuilt: p?.summary?.yearbuilt ?? 0,
      sqft: p?.building?.size?.universalsize ?? 0,
      address: p?.address?.oneLine ?? "",
    };
  } catch (error) {
    console.warn(`⚠️ Detail fetch failed for ID ${attomId}:`, error.message);
    return { beds: 0, baths: 0, lotSize: 0, yearBuilt: 0, sqft: 0, address: "" };
  }
};

const fetchSaleHistory = async (attomId) => {
  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/snapshot?attomid=${attomId}`;
    const res = await axios.get(url, {
      headers: { accept: "application/json", apikey: API_KEY },
      timeout: 5000,
    });
    const sale = res.data.property?.[0]?.salehistory?.[0];
    return {
      price: sale?.amount?.saleamt || 0,
      saleDate: sale?.saleTransDate || null,
    };
  } catch (error) {
    console.warn(`⚠️ Sale history fetch failed for ID ${attomId}:`, error.message);
    return { price: 0, saleDate: null };
  }
};

app.get("/api/comps", async (req, res) => {
  const {
    lat,
    lng,
    distance = 3,
    bedsMin,
    bedsMax,
    bathsMin,
    bathsMax,
    sqftMin,
    sqftMax,
    priceMin,
    priceMax,
    soldInLastMonths,
  } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  try {
    const now = new Date();
    const monthsAgo = soldInLastMonths
      ? new Date(now.setMonth(now.getMonth() - parseInt(soldInLastMonths)))
      : null;

    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}&pagesize=100`;
    const snapshotRes = await axios.get(url, {
      headers: { accept: "application/json", apikey: API_KEY },
      timeout: 10000,
    });

    const snapshot = snapshotRes.data.property || [];

    let subject = null;
    const enriched = await Promise.all(
      snapshot.map(async (p, i) => {
        const attomId = p.identifier?.attomId;
        const [detail, sale] = await Promise.all([
          fetchPropertyDetails(attomId),
          fetchSaleHistory(attomId),
        ]);

        const compLat = parseFloat(p.location?.latitude);
        const compLng = parseFloat(p.location?.longitude);
        const dist = haversineDistance(parseFloat(lat), parseFloat(lng), compLat, compLng);

        const result = {
          id: attomId || `attom-${i}`,
          address: detail.address || p.address?.oneLine || "Unknown",
          price: sale.price,
          sqft: detail.sqft,
          beds: detail.beds,
          baths: detail.baths,
          lotSize: detail.lotSize,
          yearBuilt: detail.yearBuilt,
          saleDate: sale.saleDate ? new Date(sale.saleDate).toISOString().split("T")[0] : null,
          lat: compLat,
          lng: compLng,
          distance: dist,
          color: "#FF0000",
        };

        if (i === 0) subject = result;
        return result;
      })
    );

    const filtered = enriched.filter((comp) => {
      if (comp.distance > parseFloat(distance)) return false;
      if (bedsMin && comp.beds < parseInt(bedsMin)) return false;
      if (bedsMax && comp.beds > parseInt(bedsMax)) return false;
      if (bathsMin && comp.baths < parseFloat(bathsMin)) return false;
      if (bathsMax && comp.baths > parseFloat(bathsMax)) return false;
      if (sqftMin && comp.sqft < parseInt(sqftMin)) return false;
      if (sqftMax && comp.sqft > parseInt(sqftMax)) return false;
      if (priceMin && comp.price < parseInt(priceMin)) return false;
      if (priceMax && comp.price > parseInt(priceMax)) return false;
      if (monthsAgo) {
        if (!comp.saleDate) return false;
        if (new Date(comp.saleDate) < monthsAgo) return false;
      }
      return true;
    });

    console.log(`✅ Filtered ${filtered.length} comps from ${snapshot.length} raw results`);
    res.json({ subject, comps: filtered });
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status || "unknown", e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

// ---------------------- Start Server ---------------------- //
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// index.js — Express backend using ATTOM API

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 3 } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}&pagesize=100`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const comps = (response.data.property || []).map((p, i) => ({
      id: p.identifier.attomId || `attom-${i}`,
      address: p.address?.oneLine || "Unknown",
      price: p.sales && p.sales.length > 0 ? p.sales[0].saleAmount : 0,
      beds: p.structure?.roomsTotal || 0,
      baths: p.structure?.totalBathroomCount || 0,
      sqft: p.building?.size?.universalsize || 0,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      color: "#FF0000"
    }));

    console.log(`✅ ATTOM returned ${comps.length} comps`);
    res.json(comps);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

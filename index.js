// index.js

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY; // ← set this in Render as env var

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const list = (response.data.property || []).map((p) => ({
      id: p.identifier.attomId,
      address: p.address.oneLine,
      price: p.sales && p.sales.length ? p.sales[0].saleAmount : 0,
      beds: p.structure?.roomsTotal || 0,
      baths: p.structure?.totalBathroomCount || 0,
      sqft: p.building?.sizeInterior ?? 0,
    }));

    console.log(`✅ ATTOM returned ${list.length} comps`);
    res.json(list);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));

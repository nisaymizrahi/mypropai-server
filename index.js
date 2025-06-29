// index.js (mypropai-server)
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    // STEP 1: Get properties by lat/lng
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const properties = response.data.property || [];

    // STEP 2: For each property, get sale history
    const results = await Promise.all(properties.map(async (p) => {
      const attomId = p.identifier.attomId;

      try {
        const salesRes = await axios.get(
          `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/snapshot?attomid=${attomId}`,
          {
            headers: {
              accept: "application/json",
              apikey: API_KEY
            }
          }
        );

        const saleData = salesRes.data.property?.[0]?.salehistory?.[0] || {};
        return {
          id: attomId,
          address: p.address?.oneLine || "Unknown",
          price: saleData.amount?.saleamt || 0,
          beds: p.structure?.roomsTotal || 0,
          baths: p.structure?.totalBathroomCount || 0,
          sqft: p.building?.size?.universalsize || 0,
          lat: p.location?.latitude,
          lng: p.location?.longitude,
        };
      } catch (err) {
        return null; // skip this property if saleshistory fails
      }
    }));

    const filtered = results.filter(r => r !== null);
    console.log(`✅ Returned ${filtered.length} enriched comps`);
    res.json(filtered);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));

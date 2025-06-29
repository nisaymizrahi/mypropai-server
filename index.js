// ✅ NEW index.js using ATTOM Sales History
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

app.get("/api/comps", async (req, res) => {
  const {
    lat,
    lng,
    distance = 1,
    bedsMin,
    bedsMax,
    bathsMin,
    bathsMax,
    sqftMin,
    sqftMax
  } = req.query;

  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    // Step 1: Get property list by lat/lng
    const geoUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}`;
    const geoRes = await axios.get(geoUrl, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const properties = geoRes.data.property || [];
    const attomIds = properties.map(p => p.identifier.attomId).slice(0, 20); // limit for now

    // Step 2: Fetch sales history for each attomId
    const results = [];

    for (const id of attomIds) {
      const detailUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail?id=${id}`;
      const detailRes = await axios.get(detailUrl, {
        headers: {
          accept: "application/json",
          apikey: API_KEY
        }
      });

      const record = detailRes.data.saleshistory?.[0];
      const prop = detailRes.data.property?.[0];

      if (record && record.saleAmount > 0 && prop?.building?.size?.size?.value) {
        const beds = prop.structure?.roomsTotal || 0;
        const baths = prop.structure?.totalBathroomCount || 0;
        const sqft = prop.building?.size?.size?.value || 0;

        // Apply filters
        if (bedsMin && beds < parseInt(bedsMin)) continue;
        if (bedsMax && beds > parseInt(bedsMax)) continue;
        if (bathsMin && baths < parseFloat(bathsMin)) continue;
        if (bathsMax && baths > parseFloat(bathsMax)) continue;
        if (sqftMin && sqft < parseInt(sqftMin)) continue;
        if (sqftMax && sqft > parseInt(sqftMax)) continue;

        results.push({
          id,
          address: prop.address?.oneLine || "Unknown",
          price: record.saleAmount,
          beds,
          baths,
          sqft,
          lat: prop.location?.latitude,
          lng: prop.location?.longitude
        });
      }
    }

    console.log(`✅ Final comps returned: ${results.length}`);
    res.json(results);
  } catch (e) {
    console.error("❌ ATTOM fetch failed:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

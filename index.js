const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1, propertyType } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const comps = (response.data.property || []).filter((p) => {
      if (!p.building) return false;
      if (!propertyType) return true;

      const attomType = p.building.type?.raw || "";
      const normalized = attomType.toUpperCase();

      // Basic matching logic
      if (propertyType === "SFR") return normalized.includes("SINGLE") || normalized.includes("SFR");
      if (propertyType === "CONDO") return normalized.includes("CONDO");
      if (propertyType === "APT") return normalized.includes("APT") || normalized.includes("APARTMENT");
      if (propertyType === "MULTI") return normalized.includes("MULTI");

      return true;
    }).map((p, i) => ({
      id: p.identifier.attomId,
      address: p.address.oneLine,
      price: p.sales && p.sales.length ? p.sales[0].saleAmount : 0,
      beds: p.structure?.roomsTotal || 0,
      baths: p.structure?.totalBathroomCount || 0,
      sqft: p.building?.sizeInterior ?? 0,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
    }));

    console.log(`✅ ATTOM returned ${comps.length} comps`);
    res.json(comps);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));

// ✅ Final index.js for ATTOM + Filters
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
    propertyType,
    bedsMin,
    bedsMax,
    bathsMin,
    bathsMax,
    sqftMin,
    sqftMax
  } = req.query;

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
      const b = p.building || {};
      const s = p.structure || {};

      const bedCount = s.roomsTotal || 0;
      const bathCount = s.totalBathroomCount || 0;
      const sqft = b.sizeInterior || 0;
      const type = b.type?.raw?.toUpperCase() || "";

      // Type filter
      if (propertyType === "SFR" && !type.includes("SINGLE") && !type.includes("SFR")) return false;
      if (propertyType === "CONDO" && !type.includes("CONDO")) return false;
      if (propertyType === "APT" && !type.includes("APT") && !type.includes("APARTMENT")) return false;
      if (propertyType === "MULTI" && !type.includes("MULTI")) return false;

      // Range filters
      if (bedsMin && bedCount < parseInt(bedsMin)) return false;
      if (bedsMax && bedCount > parseInt(bedsMax)) return false;
      if (bathsMin && bathCount < parseFloat(bathsMin)) return false;
      if (bathsMax && bathCount > parseFloat(bathsMax)) return false;
      if (sqftMin && sqft < parseInt(sqftMin)) return false;
      if (sqftMax && sqft > parseInt(sqftMax)) return false;

      return true;
    }).map((p, i) => ({
      id: p.identifier.attomId,
      address: p.address.oneLine,
      price: p.sales && p.sales.length ? p.sales[0].saleAmount : 0,
      beds: p.structure?.roomsTotal || 0,
      baths: p.structure?.totalBathroomCount || 0,
      sqft: p.building?.sizeInterior ?? 0,
      lat: p.location?.latitude,
      lng: p.location?.longitude
    }));

    console.log(`✅ ATTOM returned ${comps.length} comps`);
    res.json(comps);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

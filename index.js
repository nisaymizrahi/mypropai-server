// index.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const ATTOM_API_KEY = process.env.ATTOM_API_KEY || "ca272a177a6a376b24d88506f8fdc340";

app.get("/api/comps", async (req, res) => {
  const { street, city, county, state, zip } = req.query;

  if (!street || !city || !state || !zip || !county) {
    return res.status(400).json({ error: "Missing address parts" });
  }

  try {
    const url = `https://api.gateway.attomdata.com/property/v2/salescomparables/address/${encodeURIComponent(street)}/${encodeURIComponent(city)}/${encodeURIComponent(county)}/${state}/${zip}`;
    
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: ATTOM_API_KEY
      }
    });

    const comps = response.data?.property || [];

    const formatted = comps.map((comp, i) => ({
      id: comp.identifier?.Id || `attom-${i}`,
      address: comp.address?.oneLine || "N/A",
      price: comp.sale?.amount?.saleamt || 0,
      beds: comp.building?.rooms?.beds || 0,
      baths: comp.building?.rooms?.bathstotal || 0,
      sqft: comp.building?.size?.universalsize || 0,
      lat: comp.location?.latitude,
      lng: comp.location?.longitude,
    }));

    console.log(`✅ ATTOM comps found: ${formatted.length}`);
    res.json(formatted);
  } catch (error) {
    console.error("❌ ATTOM API error:", error.response?.status, error.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const RENTCAST_KEY = "49acb72212604bbf8db0b4b9951e4e3d"; // your key

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    const url = `https://api.rentcast.io/v1/properties/sale-comps?latitude=${lat}&longitude=${lng}&radius=${distance}`;
    const response = await axios.get(url, {
      headers: { "x-api-key": RENTCAST_KEY }
    });

    const comps = (response.data?.comps || []).map((comp, i) => ({
      id: comp.id ?? `rc-${i}`,
      address: comp.address || "Unknown",
      price: comp.price ?? 0,
      beds: comp.beds ?? 0,
      baths: comp.baths ?? 0,
      sqft: comp.sqft ?? 0,
      lat: comp.latitude ?? lat,
      lng: comp.longitude ?? lng,
      color: "#FF0000"
    }));

    console.log(`✅ RentCast returned ${comps.length} comps`);
    res.json(comps);
  } catch (err) {
    console.error("❌ RENTCAST error:", err.response?.status, err.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

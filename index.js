const express = require("express");
const cors = require("cors");
const axios = require("axios");
const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

function monthsAgoToDate(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split("T")[0]; // yyyy-mm-dd
}

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
    soldInLastMonths
  } = req.query;

  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  try {
    const baseUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot`;
    const url = `${baseUrl}?latitude=${lat}&longitude=${lng}&radius=${distance}&pagesize=100`;

    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const comps = (response.data.property || []).filter((p) => {
      const price = p.sales?.[0]?.saleAmount || 0;
      const saleDate = p.sales?.[0]?.saleTransDate;
      const beds = p.structure?.roomsTotal || 0;
      const baths = p.structure?.totalBathroomCount || 0;
      const sqft = p.building?.size?.universalsize || 0;

      if (bedsMin && beds < parseInt(bedsMin)) return false;
      if (bedsMax && beds > parseInt(bedsMax)) return false;
      if (bathsMin && baths < parseFloat(bathsMin)) return false;
      if (bathsMax && baths > parseFloat(bathsMax)) return false;
      if (sqftMin && sqft < parseInt(sqftMin)) return false;
      if (sqftMax && sqft > parseInt(sqftMax)) return false;
      if (priceMin && price < parseInt(priceMin)) return false;
      if (priceMax && price > parseInt(priceMax)) return false;

      if (soldInLastMonths && saleDate) {
        const saleTime = new Date(saleDate).getTime();
        const cutoff = new Date(monthsAgoToDate(soldInLastMonths)).getTime();
        if (saleTime < cutoff) return false;
      }

      return true;
    }).map((p, i) => ({
      id: p.identifier.attomId || `attom-${i}`,
      address: p.address?.oneLine || "Unknown",
      price: p.sales?.[0]?.saleAmount || 0,
      saleDate: p.sales?.[0]?.saleTransDate || null,
      beds: p.structure?.roomsTotal || 0,
      baths: p.structure?.totalBathroomCount || 0,
      sqft: p.building?.size?.universalsize || 0,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      color: "#FF0000"
    }));

    console.log(`✅ ATTOM returned ${comps.length} filtered comps`);
    res.json(comps);
  } catch (err) {
    console.error("❌ ATTOM error:", err.response?.status, err.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// index.js — Express backend using ATTOM API with full filtering

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

    const now = new Date();
    const monthsAgo = soldInLastMonths ? new Date(now.setMonth(now.getMonth() - parseInt(soldInLastMonths))) : null;

    const comps = (response.data.property || [])
      .map((p, i) => {
        const sale = p.sales?.[0] || {};
        const saleDate = sale.saleTransDate ? new Date(sale.saleTransDate) : null;

        return {
          id: p.identifier?.attomId || `attom-${i}`,
          address: p.address?.oneLine || "Unknown",
          price: sale.saleAmount || 0,
          beds: p.structure?.roomsTotal || 0,
          baths: p.structure?.totalBathroomCount || 0,
          sqft: p.building?.size?.universalsize || 0,
          saleDate: saleDate ? saleDate.toISOString().split("T")[0] : null,
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          color: "#FF0000"
        };
      })
      .filter((comp) => {
        if (bedsMin && comp.beds < parseInt(bedsMin)) return false;
        if (bedsMax && comp.beds > parseInt(bedsMax)) return false;
        if (bathsMin && comp.baths < parseFloat(bathsMin)) return false;
        if (bathsMax && comp.baths > parseFloat(bathsMax)) return false;
        if (sqftMin && comp.sqft < parseInt(sqftMin)) return false;
        if (sqftMax && comp.sqft > parseInt(sqftMax)) return false;
        if (priceMin && comp.price < parseInt(priceMin)) return false;
        if (priceMax && comp.price > parseInt(priceMax)) return false;
        if (monthsAgo && comp.saleDate && new Date(comp.saleDate) < monthsAgo) return false;
        return true;
      });

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

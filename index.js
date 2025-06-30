const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

// Haversine distance in miles
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fetchPropertyDetails = async (attomId) => {
  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?id=${attomId}`;
    const res = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY,
      },
      timeout: 5000,
    });

    const p = res.data.property?.[0];
    return {
      beds: p?.building?.rooms?.beds ?? 0,
      baths: p?.building?.rooms?.bathstotal ?? 0,
    };
  } catch (error) {
    console.warn(`⚠️ Detail fetch failed for ID ${attomId}:`, error.message);
    return { beds: 0, baths: 0 };
  }
};

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
    soldInLastMonths,
  } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  const originLat = parseFloat(lat);
  const originLng = parseFloat(lng);
  const maxDistance = parseFloat(distance);

  try {
    const now = new Date();
    const monthsAgo = soldInLastMonths
      ? new Date(now.setMonth(now.getMonth() - parseInt(soldInLastMonths)))
      : null;

    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}&pagesize=100`;
    const snapshotRes = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY,
      },
      timeout: 10000,
    });

    const snapshot = snapshotRes.data.property || [];

    const enriched = await Promise.all(
      snapshot.map(async (p, i) => {
        const attomId = p.identifier?.attomId;
        const detail = await fetchPropertyDetails(attomId);
        const sale = p.sales?.[0] || {};
        const saleDate = sale.saleTransDate ? new Date(sale.saleTransDate) : null;

        const lat = parseFloat(p.location?.latitude);
        const lng = parseFloat(p.location?.longitude);
        const dist = haversineMiles(originLat, originLng, lat, lng);

        return {
          id: attomId || `attom-${i}`,
          address: p.address?.oneLine || "Unknown",
          price: sale.saleAmount || 0,
          sqft: p.building?.size?.universalsize ?? 0,
          beds: detail.beds,
          baths: detail.baths,
          saleDate: saleDate ? saleDate.toISOString().split("T")[0] : null,
          lat,
          lng,
          distance: dist,
          color: "#FF0000",
        };
      })
    );

    const filtered = enriched.filter((comp) => {
      if (comp.distance > maxDistance) return false;
      if (bedsMin && comp.beds < parseInt(bedsMin)) return false;
      if (bedsMax && comp.beds > parseInt(bedsMax)) return false;
      if (bathsMin && comp.baths < parseFloat(bathsMin)) return false;
      if (bathsMax && comp.baths > parseFloat(bathsMax)) return false;
      if (sqftMin && comp.sqft < parseInt(sqftMin)) return false;
      if (sqftMax && comp.sqft > parseInt(sqftMax)) return false;
      if (priceMin && comp.price < parseInt(priceMin)) return false;
      if (priceMax && comp.price > parseInt(priceMax)) return false;
      if (soldInLastMonths && !comp.saleDate) return false;
      if (monthsAgo && comp.saleDate && new Date(comp.saleDate) < monthsAgo) return false;
      return true;
    });

    console.log(`✅ Final comps after filter: ${filtered.length}`);
    res.json(filtered);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status || "unknown", e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

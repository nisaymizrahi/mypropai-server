// index.js — Express backend using ATTOM API with full filtering and detail enrichment

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const API_KEY = process.env.ATTOM_API_KEY;

// Fetch extra details like beds/baths
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

// Fetch sale price and date
const fetchSaleHistory = async (attomId) => {
  try {
    const url = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/snapshot?attomid=${attomId}`;
    const res = await axios.get(url, {
      headers: {
        accept: "application/json",
        apikey: API_KEY,
      },
      timeout: 5000,
    });

    const sale = res.data.property?.[0]?.salehistory?.[0];
    return {
      price: sale?.amount?.saleamt || 0,
      saleDate: sale?.saleTransDate || null,
    };
  } catch (error) {
    console.warn(`⚠️ Sale history fetch failed for ID ${attomId}:`, error.message);
    return { price: 0, saleDate: null };
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

  try {
    const now = new Date();
    const monthsAgo = soldInLastMonths ? new Date(now.setMonth(now.getMonth() - parseInt(soldInLastMonths))) : null;

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
        const [detail, sale] = await Promise.all([
          fetchPropertyDetails(attomId),
          fetchSaleHistory(attomId),
        ]);

        return {
          id: attomId || `attom-${i}`,
          address: p.address?.oneLine || "Unknown",
          price: sale.price,
          sqft: p.building?.size?.universalsize ?? 0,
          beds: detail.beds,
          baths: detail.baths,
          saleDate: sale.saleDate ? new Date(sale.saleDate).toISOString().split("T")[0] : null,
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          color: "#FF0000",
        };
      })
    );

    const filtered = enriched.filter((comp) => {
      if (bedsMin && comp.beds < parseInt(bedsMin)) return false;
      if (bedsMax && comp.beds > parseInt(bedsMax)) return false;
      if (bathsMin && comp.baths < parseFloat(bathsMin)) return false;
      if (bathsMax && comp.baths > parseFloat(bathsMax)) return false;
      if (sqftMin && comp.sqft < parseInt(sqftMin)) return false;
      if (sqftMax && comp.sqft > parseInt(sqftMax)) return false;
      if (priceMin && comp.price < parseInt(priceMin)) return false;
      if (priceMax && comp.price > parseInt(priceMax)) return false;
      if (monthsAgo) {
        if (!comp.saleDate) return false;
        if (new Date(comp.saleDate) < monthsAgo) return false;
      }
      return true;
    });

    console.log(`✅ ATTOM returned ${filtered.length} enriched comps`);
    res.json(filtered);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status || "unknown", e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

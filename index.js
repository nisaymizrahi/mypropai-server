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

  if (!lat || !lng) return res.status(400).json({ error: "Missing lat or lng" });

  try {
    const snapshotUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot?latitude=${lat}&longitude=${lng}&radius=${distance}&pagesize=50`;
    const snapshotRes = await axios.get(snapshotUrl, {
      headers: {
        accept: "application/json",
        apikey: API_KEY
      }
    });

    const now = new Date();
    const monthsAgo = soldInLastMonths ? new Date(now.setMonth(now.getMonth() - parseInt(soldInLastMonths))) : null;

    const properties = snapshotRes.data.property || [];

    const enrichedComps = await Promise.all(
      properties.map(async (p, i) => {
        const attomId = p.identifier?.attomId;
        const base = {
          id: attomId || `attom-${i}`,
          address: p.address?.oneLine || "Unknown",
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          sqft: p.building?.size?.universalsize || 0,
          beds: p.structure?.roomsTotal || 0,
          baths: p.structure?.totalBathroomCount || 0,
          price: 0,
          saleDate: null,
          color: "#FF0000"
        };

        try {
          const saleRes = await axios.get(
            `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/snapshot?attomid=${attomId}`,
            {
              headers: {
                accept: "application/json",
                apikey: API_KEY
              }
            }
          );

          const sale = saleRes.data.property?.[0]?.salehistory?.[0];
          if (sale) {
            base.price = sale.amount?.saleamt || 0;
            base.saleDate = sale.saleTransDate || null;
          }
        } catch (err) {
          console.warn(`Failed to fetch saleshistory for attomId ${attomId}`);
        }

        return base;
      })
    );

    const filtered = enrichedComps.filter((comp) => {
      if (bedsMin && comp.beds < parseFloat(bedsMin)) return false;
      if (bedsMax && comp.beds > parseFloat(bedsMax)) return false;
      if (bathsMin && comp.baths < parseFloat(bathsMin)) return false;
      if (bathsMax && comp.baths > parseFloat(bathsMax)) return false;
      if (sqftMin && comp.sqft < parseFloat(sqftMin)) return false;
      if (sqftMax && comp.sqft > parseFloat(sqftMax)) return false;
      if (priceMin && comp.price < parseFloat(priceMin)) return false;
      if (priceMax && comp.price > parseFloat(priceMax)) return false;
      if (monthsAgo && comp.saleDate && new Date(comp.saleDate) < monthsAgo) return false;
      return true;
    });

    console.log(`✅ Returned ${filtered.length} enriched comps`);
    res.json(filtered);
  } catch (e) {
    console.error("❌ ATTOM API error:", e.response?.status, e.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

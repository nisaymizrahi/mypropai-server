// server/routes/comps.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

// Accepts: GET /api/comps?lat=...&lng=...&radius=1
router.get("/", async (req, res) => {
  const { lat, lng, radius = 1 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ message: "Latitude and longitude are required." });
  }

  const ATTOM_API_KEY = process.env.ATTOM_API_KEY;
  if (!ATTOM_API_KEY) {
    console.error("ATTOM_API_KEY is not set on the server.");
    return res.status(500).json({ message: "Server is missing API key." });
  }

  try {
    const salesHistoryResponse = await axios.get(
      "https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/saleshistory",
      {
        params: {
          latitude: lat,
          longitude: lng,
          radius,
          orderBy: "saleDate desc",
          pageSize: 40,
        },
        headers: { apikey: ATTOM_API_KEY, Accept: "application/json" },
      }
    );

    const sales = salesHistoryResponse.data?.property || [];

    const formattedComps = sales.map((prop) => ({
      id: prop.identifier.attomId,
      address: `${prop.address.line1}, ${prop.address.locality}, ${prop.address.countrySubd} ${prop.address.postal1}`,
      beds: prop.building?.rooms?.beds,
      baths: prop.building?.rooms?.bathsFull,
      sqft: prop.building?.size?.bldgsize,
      price: prop.sale?.amount,
      saleDate: prop.sale?.saleDate,
      lat: prop.location.latitude,
      lng: prop.location.longitude,
      distance: prop.location.distance,
    }));

    res.json(formattedComps);
  } catch (error) {
    console.error(
      "Error fetching comps from Attom API:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ message: "Failed to fetch comps from the Attom API." });
  }
});

module.exports = router;

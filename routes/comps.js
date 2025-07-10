const express = require("express");
const axios = require("axios");
const router = express.Router();

// This is the new route to handle comp searches
// It will be accessed via GET /api/comps
router.get("/", async (req, res) => {
  const { lat, lng, distance, propertyType, soldInLastMonths } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ message: "Latitude and longitude are required." });
  }

  // These are the options for the external Realtor.com API
  const options = {
    method: 'GET',
    url: 'https://realtor.p.rapidapi.com/properties/v3/list-similar-for-sale',
    params: {
      property_id: '123456789', // This is a placeholder, the API uses lat/lng primarily
      limit: '40',
      lat: lat,
      lon: lng,
      radius: distance || '1.0',
    },
    headers: {
      'X-RapidAPI-Key': process.env.REALTOR_API_KEY,
      'X-RapidAPI-Host': 'realtor.p.rapidapi.com'
    }
  };

  try {
    const response = await axios.request(options);
    const properties = response.data?.data?.home_search?.results || [];

    // Transform the data to match what the frontend expects
    const formattedComps = properties.map(prop => ({
        id: prop.property_id,
        address: `${prop.location.address.line}, ${prop.location.address.city}, ${prop.location.address.state_code} ${prop.location.address.postal_code}`,
        beds: prop.description.beds,
        baths: prop.description.baths_full,
        sqft: prop.description.sqft,
        price: prop.list_price,
        saleDate: prop.list_date, // Using list_date as a stand-in for saleDate
        lat: prop.location.address.coordinate.lat,
        lng: prop.location.address.coordinate.lon,
        distance: prop.location.search_comments?.distance_from_subject || 0
    }));

    res.json(formattedComps);

  } catch (error) {
    console.error("Error fetching comps from Realtor API:", error.response ? error.response.data : error.message);
    res.status(500).json({ message: "Failed to fetch comps from external API." });
  }
});

module.exports = router;
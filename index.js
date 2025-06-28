const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors({ origin: "*" }));

const ATTOM_API_KEY = "ca272a177a6a376b24d88506f8fdc340";

app.get("/api/comps", async (req, res) => {
  // 🧪 Try broader search with city + zip
  const city = "New York";
  const state = "NY";
  const postalcode = "10019";

  try {
    const url = "https://api.gateway.attomdata.com/propertyapi/v1.0.0/salescomps";
    const params = {
      city,
      state,
      postalcode,
      radius: 1
    };

    const response = await axios.get(url, {
      headers: {
        apikey: ATTOM_API_KEY,
        accept: "application/json"
      },
      params
    });

    const comps = (response.data?.property || []).map((prop, i) => ({
      id: prop.apn || `attom-${i}`,
      address: prop.address?.line1 || "Unknown",
      price: prop.sale?.amount || 0,
      beds: prop.building?.rooms?.beds || 0,
      baths: prop.building?.rooms?.baths || 0,
      sqft: prop.building?.size?.livingsize || 0,
      yearBuilt: prop.building?.yearbuilt || null
    }));

    console.log(`✅ Retrieved ${comps.length} comps from ATTOM`);
    res.json(comps);
  } catch (error) {
    console.error("❌ ATTOM API error:", error.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

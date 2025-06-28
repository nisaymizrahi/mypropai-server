const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const ATTOM_API_KEY = "ca272a177a6a376b24d88506f8fdc340"; // ✅ your working key

app.get("/api/comps", async (req, res) => {
  // 🧪 Replace this with user input later
  const address = "157 W 57th St";
  const postalcode = "10019";
  const radius = 1;

  try {
    const url = "https://api.gateway.attomdata.com/propertyapi/v1.0.0/salescomps/v2";
    const params = {
      address,
      postalcode,
      radius
    };

    const response = await axios.get(url, {
      headers: {
        apikey: ATTOM_API_KEY,
        accept: "application/json"
      },
      params
    });

    const comps = (response.data?.comps || []).map((comp, i) => ({
      id: comp.identifier?.obPropId || `attom-${i}`,
      address: comp.property?.address?.line1 || "Unknown",
      price: comp.sale?.amount || 0,
      beds: comp.building?.rooms?.beds || 0,
      baths: comp.building?.rooms?.baths || 0,
      sqft: comp.building?.size?.livingsize || 0,
      yearBuilt: comp.building?.yearbuilt || null,
      lat: comp.location?.latitude,
      lng: comp.location?.longitude,
      color: "#FF0000"
    }));

    console.log(`✅ ATTOM returned ${comps.length} comps`);
    res.json(comps);
  } catch (error) {
    console.error("❌ ATTOM error:", error.response?.status, error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch comps" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

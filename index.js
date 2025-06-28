const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  try {
    const url = `https://www.realtor.com/realestateandhomes-search/geo/${lat},${lng}/sold/pg-1?radius=${distance}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const comps = [];

    $("li[data-testid='result-card']").each((i, el) => {
      const address = $(el).find("[data-label='pc-address']").text().trim();
      const priceText = $(el).find("[data-label='pc-price']").text().trim();
      const beds = $(el).find("[data-label='pc-meta-beds']").text().trim();
      const baths = $(el).find("[data-label='pc-meta-baths']").text().trim();
      const sqft = $(el).find("[data-label='pc-meta-sqft']").text().trim();

      comps.push({
        id: `server-comp-${i}`,
        address,
        price: parseInt(priceText.replace(/[^\d]/g, "") || "0"),
        beds: parseInt(beds.replace(/[^\d]/g, "") || "0"),
        baths: parseInt(baths.replace(/[^\d]/g, "") || "0"),
        sqft: parseInt(sqft.replace(/[^\d]/g, "") || "0"),
      });
    });
    console.log(`✅ Found ${comps.length} comps for lat=${lat}, lng=${lng}`);
    res.json(comps);
  } catch (error) {
    console.error("Scraping error:", error.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

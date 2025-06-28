const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors({ origin: "*" }));

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  try {
    const url = `https://www.realtor.com/realestateandhomes-search/geo/${lat},${lng}/sold/pg-1?radius=${distance}`;
    console.log("🔍 Scraping URL:", url);

    const response = await axios.get(url, { timeout: 8000 });
    const $ = cheerio.load(response.data);

    const results = $("li[data-testid='result-card']");
    console.log("📄 Found", results.length, "'result-card' items");
    console.log("🧾 HTML sample:", $.html().slice(0, 1000));

    const comps = [];

    results.each((i, el) => {
      const address = $(el).find("[data-label='pc-address']").text()?.trim() || "Unknown";
      const priceText = $(el).find("[data-label='pc-price']").text()?.trim() || "0";
      const beds = $(el).find("[data-label='pc-meta-beds']").text()?.trim() || "0";
      const baths = $(el).find("[data-label='pc-meta-baths']").text()?.trim() || "0";
      const sqft = $(el).find("[data-label='pc-meta-sqft']").text()?.trim() || "0";

      comps.push({
        id: `server-comp-${i}`,
        address,
        price: parseInt(priceText.replace(/[^\d]/g, "") || "0"),
        beds: parseInt(beds.replace(/[^\d]/g, "") || "0"),
        baths: parseFloat(baths.replace(/[^\d.]/g, "") || "0"),
        sqft: parseInt(sqft.replace(/[^\d]/g, "") || "0"),
      });
    });

    console.log(`✅ Found ${comps.length} comps for lat=${lat}, lng=${lng}`);
    res.json(comps);
  } catch (error) {
    console.error("❌ Scraping error:", error.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

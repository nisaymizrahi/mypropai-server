const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors({ origin: "*" }));

const SCRAPINGBEE_API_KEY = "W7GE7DBLEZDE7Q1YAEPTZ52ESK19934P1FKJMFO4091XZTBIKVA1J74ZLRCWOELEE5GJCFBH2SGN6MGQ";

app.get("/api/comps", async (req, res) => {
  const { lat, lng, distance = 1 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  try {
    const targetUrl = `https://www.realtor.com/realestateandhomes-search/geo/${lat},${lng}/sold/pg-1?radius=${distance}`;
    const scraperUrl = `https://app.scrapingbee.com/api/v1?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(targetUrl)}&render_js=true`;

    console.log("🔍 Scraping via ScrapingBee:", targetUrl);

    const response = await axios.get(scraperUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const results = $("li[data-testid='result-card']");
    console.log("📄 Found", results.length, "'result-card' items");

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

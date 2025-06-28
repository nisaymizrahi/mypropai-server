const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors({ origin: "*" }));

const SCRAPINGBEE_API_KEY = "W7GE7DBLEZDE7Q1YAEPTZ52ESK19934P1FKJMFO4091XZTBIKVA1J74ZLRCWOELEE5GJCFBH2SGN6MGQ";

app.get("/api/comps", async (req, res) => {
  try {
    const cityUrl = "https://www.redfin.com/city/30749/NY/New-York/filter/include=sold-3mo"; // ← You can change city later
    const scraperUrl = `https://app.scrapingbee.com/api/v1?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(cityUrl)}&render_js=true`;

    console.log("🔍 Scraping Redfin sold listings for New York...");

    const response = await axios.get(scraperUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const cards = $("div.HomeCardContainer");

    console.log("📄 Found", cards.length, "Redfin home cards");

    const comps = [];

    cards.each((i, el) => {
      const address = $(el).find("div.addressDisplay").text()?.trim() || "Unknown";
      const priceText = $(el).find("span.homecardV2Price").text()?.trim() || "0";
      const statsText = $(el).find("div.stats").text();
      const beds = statsText.match(/(\d+)\s+Beds?/i)?.[1] || "0";
      const baths = statsText.match(/(\d+)\s+Baths?/i)?.[1] || "0";
      const sqft = statsText.match(/([\d,]+)\s+Sq Ft/i)?.[1]?.replace(/,/g, "") || "0";

      comps.push({
        id: `redfin-comp-${i}`,
        address,
        price: parseInt(priceText.replace(/[^\d]/g, "") || "0"),
        beds: parseInt(beds),
        baths: parseFloat(baths),
        sqft: parseInt(sqft),
      });
    });

    console.log(`✅ Found ${comps.length} comps`);
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

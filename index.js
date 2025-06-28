const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors({ origin: "*" }));

const SCRAPINGBEE_API_KEY = "W7GE7DBLEZDE7Q1YAEPTZ52ESK19934P1FKJMFO4091XZTBIKVA1J74ZLRCWOELEE5GJCFBH2SGN6MGQ";

app.get("/api/comps", async (req, res) => {
  try {
    const cityUrl = "https://www.redfin.com/city/30749/NY/New-York/filter/include=sold-3mo";
    const scraperUrl = `https://app.scrapingbee.com/api/v1?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(cityUrl)}&render_js=true`;

    console.log("🔍 Scraping Redfin with ScrapingBee...");

    const response = await axios.get(scraperUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const reduxScript = $("#__REDUX_STATE__").html();

    if (!reduxScript) {
      console.error("❌ Could not find embedded JSON");
      return res.status(500).json({ error: "Embedded data not found" });
    }

    const data = JSON.parse(reduxScript);
    const homeCards = data?.homeCards || [];

    console.log(`✅ Extracted ${homeCards.length} comps from JSON`);

    const comps = homeCards.map((home, i) => ({
      id: `redfin-${home.mlsId || i}`,
      address: home.address?.streetLine || "Unknown",
      price: home.price || 0,
      beds: home.beds || 0,
      baths: home.baths || 0,
      sqft: home.sqft || 0,
    }));

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

const express = require("express");
const {
  fetchRentCastValueEstimate,
  getLeadPropertyPreview,
  numberOrNull,
} = require("../utils/leadPropertyService");

const router = express.Router();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const matchesNumericRange = (value, min, max) => {
  const hasRange =
    (min !== null && min !== undefined) || (max !== null && max !== undefined);
  if (hasRange && (value === null || value === undefined)) return false;
  if (min !== null && min !== undefined && value < min) return false;
  if (max !== null && max !== undefined && value > max) return false;
  return true;
};

const normalizeComparable = (comp = {}) => ({
  id: comp.id || comp.formattedAddress || `${comp.latitude},${comp.longitude}`,
  address:
    comp.formattedAddress ||
    [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
      .filter(Boolean)
      .join(", "),
  beds: numberOrNull(comp.bedrooms),
  baths: numberOrNull(comp.bathrooms),
  sqft: numberOrNull(comp.squareFootage),
  price: numberOrNull(comp.price),
  saleDate: comp.listedDate || comp.lastSeenDate || comp.removedDate || null,
  lat: numberOrNull(comp.latitude),
  lng: numberOrNull(comp.longitude),
  distance: numberOrNull(comp.distance),
  propertyType: comp.propertyType || "",
  status: comp.status || "",
  correlation: numberOrNull(comp.correlation),
});

router.get("/", async (req, res) => {
  try {
    const address = String(req.query.address || "").trim();
    if (!address) {
      return res.status(400).json({ message: "Address is required." });
    }

    const radius = clamp(numberOrNull(req.query.radius) ?? numberOrNull(req.query.distance) ?? 1, 0.25, 10);
    const propertyType = String(req.query.propertyType || "").trim().toLowerCase();
    const minBeds = numberOrNull(req.query.minBeds);
    const maxBeds = numberOrNull(req.query.maxBeds);
    const minBaths = numberOrNull(req.query.minBaths);
    const maxBaths = numberOrNull(req.query.maxBaths);
    const minSqft = numberOrNull(req.query.minSqft);
    const maxSqft = numberOrNull(req.query.maxSqft);

    const subject = await getLeadPropertyPreview({ address });
    const avm = await fetchRentCastValueEstimate({
      ...subject,
      address: subject.address || address,
      compCount: 12,
    });

    let comps = Array.isArray(avm?.comparables) ? avm.comparables.map(normalizeComparable) : [];

    if (radius) {
      comps = comps.filter((comp) => comp.distance === null || comp.distance <= radius);
    }

    if (propertyType) {
      comps = comps.filter((comp) => comp.propertyType.toLowerCase() === propertyType);
    }

    comps = comps.filter(
      (comp) =>
        matchesNumericRange(comp.beds, minBeds, maxBeds) &&
        matchesNumericRange(comp.baths, minBaths, maxBaths) &&
        matchesNumericRange(comp.sqft, minSqft, maxSqft)
    );

    res.json(comps);
  } catch (error) {
    console.error("Error fetching market comps:", error.response?.data || error.message);
    res.status(500).json({ message: "Failed to fetch comparable properties." });
  }
});

module.exports = router;

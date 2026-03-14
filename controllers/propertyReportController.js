const Lead = require("../models/Lead");
const PropertyReport = require("../models/PropertyReport");
const {
  buildLegacyCompsAnalysisSnapshot,
  generateAiReport,
  sanitizeSelectedComparable,
  summarizeComps,
} = require("../utils/compsAnalysisService");

const buildDefaultTitle = (address = "", generatedAt = new Date()) => {
  const safeAddress = String(address || "").trim() || "Property";
  const formattedDate = new Date(generatedAt).toLocaleDateString();
  return `${safeAddress} - AI Comps Report - ${formattedDate}`;
};

const formatCompsReportResponse = (report) => {
  const source = report?.toObject ? report.toObject() : report;
  if (!source) return null;

  return {
    _id: source._id,
    kind: source.kind,
    contextType: source.contextType,
    title: source.title,
    address: source.address,
    generatedAt: source.generatedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    subjectSnapshot: source.subjectSnapshot || null,
    filters: source.filters || null,
    valuationContext: source.valuationContext || null,
    estimatedValue: source.summary?.estimatedValue ?? null,
    estimatedValueLow: source.summary?.estimatedValueLow ?? null,
    estimatedValueHigh: source.summary?.estimatedValueHigh ?? null,
    averageSoldPrice: source.summary?.averageSoldPrice ?? null,
    medianSoldPrice: source.summary?.medianSoldPrice ?? null,
    lowSoldPrice: source.summary?.lowSoldPrice ?? null,
    highSoldPrice: source.summary?.highSoldPrice ?? null,
    averagePricePerSqft: source.summary?.averagePricePerSqft ?? null,
    medianPricePerSqft: source.summary?.medianPricePerSqft ?? null,
    lowPricePerSqft: source.summary?.lowPricePerSqft ?? null,
    highPricePerSqft: source.summary?.highPricePerSqft ?? null,
    averageDaysOnMarket: source.summary?.averageDaysOnMarket ?? null,
    medianDaysOnMarket: source.summary?.medianDaysOnMarket ?? null,
    lowDaysOnMarket: source.summary?.lowDaysOnMarket ?? null,
    highDaysOnMarket: source.summary?.highDaysOnMarket ?? null,
    saleCompCount: source.summary?.saleCompCount ?? null,
    askingPriceDelta: source.summary?.askingPriceDelta ?? null,
    recommendedOfferLow: source.summary?.recommendedOfferLow ?? null,
    recommendedOfferHigh: source.summary?.recommendedOfferHigh ?? null,
    report: source.ai || null,
    recentComps: Array.isArray(source.comps) ? source.comps : [],
  };
};

exports.listReports = async (req, res) => {
  try {
    const kind = String(req.query.kind || "comps").trim();
    const contextType = String(req.query.contextType || "").trim();
    const leadId = String(req.query.leadId || "").trim();

    if (kind !== "comps") {
      return res.status(400).json({ msg: "Unsupported report kind." });
    }

    const query = {
      user: req.user.id,
      kind,
    };

    if (contextType) {
      query.contextType = contextType;
    }

    if (contextType === "lead") {
      if (!leadId) {
        return res.status(400).json({ msg: "leadId is required for lead reports." });
      }

      const lead = await Lead.findOne({ _id: leadId, user: req.user.id }).select("_id");
      if (!lead) {
        return res.status(404).json({ msg: "Lead not found." });
      }

      query.lead = lead._id;
    }

    if (contextType === "standalone") {
      query.lead = null;
      query.investment = null;
    }

    const reports = await PropertyReport.find(query).sort({ generatedAt: -1, createdAt: -1 }).lean();
    res.json(reports.map(formatCompsReportResponse));
  } catch (error) {
    console.error("List property reports error:", error);
    res.status(500).json({ msg: "Failed to fetch saved reports." });
  }
};

exports.saveCompsReport = async (req, res) => {
  try {
    const {
      contextType,
      leadId,
      subject = {},
      filters = {},
      valuationContext = null,
      selectedComps = [],
      title = "",
    } = req.body || {};

    const normalizedContextType = String(contextType || "").trim();
    if (!["lead", "standalone"].includes(normalizedContextType)) {
      return res.status(400).json({ msg: "A valid report contextType is required." });
    }

    if (!subject?.address) {
      return res.status(400).json({ msg: "Address is required to save a report." });
    }

    const comps = selectedComps
      .map((comp, index) => sanitizeSelectedComparable(comp, index))
      .filter(Boolean);

    if (comps.length < 3) {
      return res.status(400).json({ msg: "Select at least 3 comparables before saving." });
    }

    let lead = null;
    if (normalizedContextType === "lead") {
      if (!leadId) {
        return res.status(400).json({ msg: "leadId is required to save a lead report." });
      }

      lead = await Lead.findOne({ _id: leadId, user: req.user.id });
      if (!lead) {
        return res.status(404).json({ msg: "Lead not found." });
      }
    }

    const summary = summarizeComps(subject, comps, valuationContext || null);
    const aiReport = await generateAiReport(
      subject,
      summary,
      comps,
      valuationContext || null,
      filters || null
    ).catch((error) => {
      console.error("Save comps report AI generation failed:", error.response?.data || error.message);
      return null;
    });

    const generatedAt = new Date();
    const report = await PropertyReport.create({
      user: req.user.id,
      kind: "comps",
      contextType: normalizedContextType,
      lead: lead?._id || null,
      title: String(title || "").trim() || buildDefaultTitle(subject.address, generatedAt),
      address: subject.address,
      generatedAt,
      subjectSnapshot: subject,
      filters,
      valuationContext: valuationContext || null,
      summary,
      ai: aiReport || null,
      comps,
    });

    if (lead) {
      lead.compsAnalysis = buildLegacyCompsAnalysisSnapshot({
        generatedAt,
        filters,
        valuationContext: valuationContext || null,
        summary,
        aiReport,
        comps,
      });
      await lead.save();
    }

    res.status(201).json(formatCompsReportResponse(report));
  } catch (error) {
    console.error("Save comps report error:", error);
    res.status(500).json({ msg: "Failed to save comps report." });
  }
};

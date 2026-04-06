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

  const reportData = source.reportData || null;
  const summary = source.summary || reportData?.summary || null;
  const ai = source.ai || reportData?.aiVerdict || null;
  const comps = Array.isArray(source.comps) && source.comps.length
    ? source.comps
    : Array.isArray(reportData?.recentComps)
      ? reportData.recentComps
      : Array.isArray(reportData?.comps?.primary?.items)
        ? reportData.comps.primary.items
        : [];

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
    dealSnapshot: source.dealSnapshot || reportData?.dealInputs || null,
    filters: source.filters || null,
    valuationContext: source.valuationContext || null,
    estimatedValue: summary?.estimatedValue ?? reportData?.valuation?.blendedEstimate ?? null,
    estimatedValueLow: summary?.estimatedValueLow ?? reportData?.valuation?.blendedLow ?? null,
    estimatedValueHigh: summary?.estimatedValueHigh ?? reportData?.valuation?.blendedHigh ?? null,
    averageSoldPrice: summary?.averageSoldPrice ?? null,
    medianSoldPrice: summary?.medianSoldPrice ?? reportData?.comps?.primary?.summary?.medianPrice ?? null,
    lowSoldPrice: summary?.lowSoldPrice ?? null,
    highSoldPrice: summary?.highSoldPrice ?? null,
    averagePricePerSqft: summary?.averagePricePerSqft ?? reportData?.comps?.primary?.summary?.averagePricePerSqft ?? null,
    medianPricePerSqft: summary?.medianPricePerSqft ?? reportData?.comps?.primary?.summary?.medianPricePerSqft ?? null,
    lowPricePerSqft: summary?.lowPricePerSqft ?? null,
    highPricePerSqft: summary?.highPricePerSqft ?? null,
    averageDaysOnMarket: summary?.averageDaysOnMarket ?? null,
    medianDaysOnMarket: summary?.medianDaysOnMarket ?? null,
    lowDaysOnMarket: summary?.lowDaysOnMarket ?? null,
    highDaysOnMarket: summary?.highDaysOnMarket ?? null,
    saleCompCount: summary?.saleCompCount ?? reportData?.comps?.primary?.summary?.count ?? null,
    askingPriceDelta: summary?.askingPriceDelta ?? null,
    recommendedOfferLow: summary?.recommendedOfferLow ?? null,
    recommendedOfferHigh: summary?.recommendedOfferHigh ?? null,
    report: ai,
    recentComps: comps,
    reportData,
    reportVersion: source.reportVersion || reportData?.masterReportVersion || 1,
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
      deal = {},
      filters = {},
      valuationContext = null,
      selectedComps = [],
      reportData = null,
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

    const summary = reportData?.summary || summarizeComps(subject, comps, valuationContext || null);
    const aiReport =
      reportData?.aiVerdict ||
      (await generateAiReport(
        subject,
        summary,
        comps,
        valuationContext || null,
        filters || null
      ).catch((error) => {
        console.error("Save comps report AI generation failed:", error.response?.data || error.message);
        return null;
      }));

    const generatedAt = new Date();
    const normalizedReportData = reportData || null;
    const normalizedDeal = deal || normalizedReportData?.dealInputs || null;
    const report = await PropertyReport.create({
      user: req.user.id,
      kind: "comps",
      contextType: normalizedContextType,
      lead: lead?._id || null,
      title: String(title || "").trim() || buildDefaultTitle(subject.address, generatedAt),
      address: subject.address,
      generatedAt,
      subjectSnapshot: subject,
      dealSnapshot: normalizedDeal,
      filters,
      valuationContext: valuationContext || null,
      summary,
      ai: aiReport || null,
      comps,
      reportData: normalizedReportData,
      reportVersion: normalizedReportData?.masterReportVersion || 1,
    });

    if (lead) {
      lead.compsAnalysis = buildLegacyCompsAnalysisSnapshot({
        generatedAt,
        filters,
            valuationContext: valuationContext || null,
            summary,
            aiReport:
              aiReport && aiReport.verdict
                ? {
                    headline: aiReport.headline,
                    executiveSummary: aiReport.executiveSummary,
                    pricingRecommendation: aiReport.valueTakeaway,
                    offerStrategy: aiReport.dealTakeaway,
                    confidence: aiReport.confidence,
                    riskFlags: aiReport.riskFlags,
                    nextSteps: aiReport.nextSteps,
                  }
                : aiReport,
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

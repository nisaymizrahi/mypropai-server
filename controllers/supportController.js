const SupportRequest = require("../models/SupportRequest");
const sendEmail = require("../utils/sendEmail");
const { getPlatformManagerEmails, normalizeEmail } = require("../utils/platformAccess");

const REQUEST_TYPE_LABELS = {
  general_question: "General question",
  report_issue: "Issue report",
  account_help: "Account help",
  billing_help: "Billing help",
  feature_request: "Feature request",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeOptionalString = (value, maxLength = 255) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizeMultilineText = (value, maxLength = 5000) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildSupportRecipientList = () => {
  const configuredSupportEmails = String(
    process.env.SUPPORT_EMAILS || process.env.SUPPORT_EMAIL || ""
  )
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);

  return [
    ...new Set([...configuredSupportEmails, ...Array.from(getPlatformManagerEmails())]),
  ];
};

const buildReferenceCode = (supportRequestId) =>
  `SUP-${String(supportRequestId).slice(-6).toUpperCase()}`;

const buildSupportEmailHtml = (supportRequest, referenceCode) => {
  const requestTypeLabel =
    REQUEST_TYPE_LABELS[supportRequest.requestType] || "Support request";
  const detailRows = [
    ["Reference", referenceCode],
    ["Type", requestTypeLabel],
    ["Name", supportRequest.name],
    ["Email", supportRequest.email],
    ["Company", supportRequest.companyName || "Not provided"],
    ["Subject", supportRequest.subject],
    ["Page or feature", supportRequest.pageUrl || "Not provided"],
    ["Source", supportRequest.source || "website_help_center"],
    ["Submitted", new Date(supportRequest.createdAt).toLocaleString("en-US")],
  ];

  const rowsMarkup = detailRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #ece7e1;">${escapeHtml(
          label
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #ece7e1;">${escapeHtml(
          value
        )}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#1c1713;line-height:1.6;">
      <h2 style="margin:0 0 16px;">New Fliprop support request</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ece7e1;border-radius:12px;overflow:hidden;">
        <tbody>${rowsMarkup}</tbody>
      </table>
      <div style="margin-top:16px;padding:16px;border:1px solid #ece7e1;border-radius:12px;background:#fcfaf7;">
        <p style="margin:0 0 8px;font-weight:600;">Message</p>
        <p style="margin:0;white-space:pre-wrap;">${escapeHtml(supportRequest.message)}</p>
      </div>
      ${
        supportRequest.userAgent
          ? `<p style="margin-top:16px;font-size:12px;color:#71655c;">User agent: ${escapeHtml(
              supportRequest.userAgent
            )}</p>`
          : ""
      }
    </div>
  `;
};

exports.createSupportRequest = async (req, res) => {
  try {
    const name = normalizeOptionalString(req.body?.name, 120);
    const email = normalizeEmail(req.body?.email || "");
    const companyName = normalizeOptionalString(req.body?.companyName, 160);
    const requestType = normalizeOptionalString(req.body?.requestType, 40);
    const subject = normalizeOptionalString(req.body?.subject, 160);
    const message = normalizeMultilineText(req.body?.message, 5000);
    const pageUrl = normalizeOptionalString(req.body?.pageUrl, 500);
    const source = normalizeOptionalString(req.body?.source, 80) || "website_help_center";
    const userAgent = normalizeOptionalString(req.headers["user-agent"], 500);

    if (!name) {
      return res.status(400).json({ msg: "Please enter your name." });
    }

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ msg: "Please enter a valid email address." });
    }

    if (!REQUEST_TYPE_LABELS[requestType]) {
      return res.status(400).json({ msg: "Please choose what you need help with." });
    }

    if (!subject) {
      return res.status(400).json({ msg: "Please add a short subject for your request." });
    }

    if (!message || message.length < 10) {
      return res
        .status(400)
        .json({ msg: "Please share a few details so we know how to help." });
    }

    const supportRequest = await SupportRequest.create({
      name,
      email,
      companyName,
      requestType,
      subject,
      message,
      pageUrl,
      source,
      userAgent,
    });

    const referenceCode = buildReferenceCode(supportRequest._id);
    const recipients = buildSupportRecipientList();
    let emailDelivered = false;

    if (recipients.length && process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) {
      try {
        await sendEmail({
          to: recipients.join(","),
          subject: `[${referenceCode}] ${REQUEST_TYPE_LABELS[requestType]}: ${subject}`,
          html: buildSupportEmailHtml(supportRequest, referenceCode),
        });

        supportRequest.notificationRecipients = recipients;
        supportRequest.notifiedAt = new Date();
        await supportRequest.save();
        emailDelivered = true;
      } catch (emailError) {
        console.error("Support request email delivery failed:", emailError.message);
      }
    }

    return res.status(201).json({
      message: "Support request received.",
      request: {
        id: supportRequest._id,
        referenceCode,
        emailDelivered,
      },
    });
  } catch (error) {
    console.error("Create support request error:", error);
    return res.status(500).json({ msg: "We couldn't submit your request right now." });
  }
};

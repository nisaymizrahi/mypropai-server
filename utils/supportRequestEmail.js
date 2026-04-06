const { getPlatformManagerEmails, normalizeEmail } = require("./platformAccess");

const SUPPORT_REQUEST_TYPE_LABELS = {
  general_question: "General question",
  report_issue: "Issue report",
  account_help: "Account help",
  billing_help: "Billing help",
  feature_request: "Feature request",
};

const SUPPORT_REQUEST_STATUS_LABELS = {
  new: "New",
  in_progress: "In progress",
  resolved: "Resolved",
};

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

const getSupportReplyTo = () => buildSupportRecipientList()[0] || null;

const buildSupportRequestReferenceCode = (requestId) =>
  `SUP-${String(requestId).slice(-6).toUpperCase()}`;

const formatSupportTimestamp = (value) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    return "Unknown";
  }

  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const buildTableRowsMarkup = (rows = []) =>
  rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #ece7e1;">${escapeHtml(
          label
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #ece7e1;">${escapeHtml(
          value
        )}</td></tr>`
    )
    .join("");

const buildSupportInboxNotificationEmail = (supportRequest, referenceCode) => {
  const requestTypeLabel =
    SUPPORT_REQUEST_TYPE_LABELS[supportRequest.requestType] || "Support request";
  const detailRows = [
    ["Reference", referenceCode],
    ["Type", requestTypeLabel],
    ["Name", supportRequest.name],
    ["Email", supportRequest.email],
    ["Company", supportRequest.companyName || "Not provided"],
    ["Subject", supportRequest.subject],
    ["Page or feature", supportRequest.pageUrl || "Not provided"],
    ["Source", supportRequest.source || "website_help_center"],
    ["Submitted", formatSupportTimestamp(supportRequest.createdAt)],
  ];

  return `
    <div style="font-family:Arial,sans-serif;color:#1c1713;line-height:1.6;">
      <h2 style="margin:0 0 16px;">New Fliprop support request</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ece7e1;border-radius:12px;overflow:hidden;">
        <tbody>${buildTableRowsMarkup(detailRows)}</tbody>
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

const buildSupportRequesterConfirmationEmail = (supportRequest, referenceCode) => {
  const requestTypeLabel =
    SUPPORT_REQUEST_TYPE_LABELS[supportRequest.requestType] || "Support request";
  const detailRows = [
    ["Reference", referenceCode],
    ["Status", SUPPORT_REQUEST_STATUS_LABELS[supportRequest.status || "new"] || "New"],
    ["Type", requestTypeLabel],
    ["Subject", supportRequest.subject],
    ["Submitted", formatSupportTimestamp(supportRequest.createdAt)],
  ];

  return `
    <div style="font-family:Arial,sans-serif;color:#1c1713;line-height:1.6;">
      <h2 style="margin:0 0 12px;">We received your Fliprop support request</h2>
      <p style="margin:0 0 16px;">
        Hi ${escapeHtml(supportRequest.name || "there")}, thanks for reaching out. Your request is in
        our queue and we'll follow up using this email address.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ece7e1;border-radius:12px;overflow:hidden;">
        <tbody>${buildTableRowsMarkup(detailRows)}</tbody>
      </table>
      <div style="margin-top:16px;padding:16px;border:1px solid #ece7e1;border-radius:12px;background:#fcfaf7;">
        <p style="margin:0 0 8px;font-weight:600;">Your message</p>
        <p style="margin:0;white-space:pre-wrap;">${escapeHtml(supportRequest.message)}</p>
      </div>
      <p style="margin:16px 0 0;color:#5f544b;">
        Keep this email for reference. If you need to send more detail, reply with the reference code above.
      </p>
    </div>
  `;
};

const buildSupportStatusUpdateEmail = (supportRequest, referenceCode, previousStatus = "new") => {
  const nextStatus = supportRequest.status || "new";
  const nextStatusLabel = SUPPORT_REQUEST_STATUS_LABELS[nextStatus] || "Updated";
  const previousStatusLabel = SUPPORT_REQUEST_STATUS_LABELS[previousStatus] || "New";
  const title =
    nextStatus === "resolved"
      ? "Your Fliprop support request was marked resolved"
      : nextStatus === "in_progress"
        ? "Your Fliprop support request is in progress"
        : "Your Fliprop support request was reopened";

  return `
    <div style="font-family:Arial,sans-serif;color:#1c1713;line-height:1.6;">
      <h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 16px;">
        Hi ${escapeHtml(supportRequest.name || "there")}, we updated the status of your request.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ece7e1;border-radius:12px;overflow:hidden;">
        <tbody>${buildTableRowsMarkup([
          ["Reference", referenceCode],
          ["Subject", supportRequest.subject],
          ["Previous status", previousStatusLabel],
          ["Current status", nextStatusLabel],
          ["Updated", formatSupportTimestamp(new Date())],
        ])}</tbody>
      </table>
      <p style="margin:16px 0 0;color:#5f544b;">
        Reply with ${escapeHtml(referenceCode)} if you want to add more details to this conversation.
      </p>
    </div>
  `;
};

module.exports = {
  SUPPORT_REQUEST_STATUS_LABELS,
  SUPPORT_REQUEST_TYPE_LABELS,
  buildSupportInboxNotificationEmail,
  buildSupportRecipientList,
  buildSupportRequestReferenceCode,
  buildSupportRequesterConfirmationEmail,
  buildSupportStatusUpdateEmail,
  getSupportReplyTo,
};

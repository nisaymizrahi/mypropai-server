const SupportRequest = require("../models/SupportRequest");
const sendEmail = require("../utils/sendEmail");
const { normalizeEmail } = require("../utils/platformAccess");
const {
  SUPPORT_REQUEST_TYPE_LABELS,
  buildSupportInboxNotificationEmail,
  buildSupportRecipientList,
  buildSupportRequestReferenceCode,
  buildSupportRequesterConfirmationEmail,
  getSupportReplyTo,
} = require("../utils/supportRequestEmail");

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

    if (!SUPPORT_REQUEST_TYPE_LABELS[requestType]) {
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

    const referenceCode = buildSupportRequestReferenceCode(supportRequest._id);
    const recipients = buildSupportRecipientList();
    const replyTo = getSupportReplyTo();
    let emailDelivered = false;
    let requesterEmailDelivered = false;

    if (process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) {
      if (recipients.length) {
        try {
          await sendEmail({
            to: recipients.join(","),
            subject: `[${referenceCode}] ${SUPPORT_REQUEST_TYPE_LABELS[requestType]}: ${subject}`,
            html: buildSupportInboxNotificationEmail(supportRequest, referenceCode),
            replyTo,
          });

          supportRequest.notificationRecipients = recipients;
          supportRequest.notifiedAt = new Date();
          await supportRequest.save();
          emailDelivered = true;
        } catch (emailError) {
          console.error("Support request email delivery failed:", emailError.message);
        }
      }

      try {
        await sendEmail({
          to: supportRequest.email,
          subject: `We received your Fliprop support request (${referenceCode})`,
          html: buildSupportRequesterConfirmationEmail(supportRequest, referenceCode),
          replyTo,
        });
        requesterEmailDelivered = true;
      } catch (emailError) {
        console.error("Support requester confirmation email failed:", emailError.message);
      }
    }

    return res.status(201).json({
      message: "Support request received.",
      request: {
        id: supportRequest._id,
        referenceCode,
        emailDelivered,
        requesterEmailDelivered,
      },
    });
  } catch (error) {
    console.error("Create support request error:", error);
    return res.status(500).json({ msg: "We couldn't submit your request right now." });
  }
};

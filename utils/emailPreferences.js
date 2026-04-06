const { signJwt, verifyJwt } = require("./jwtConfig");
const { normalizeEmail } = require("./platformAccess");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const EMAIL_PREFERENCE_PURPOSE = "email_preferences";
const DEFAULT_LIST_KEY = "marketing";
const DEFAULT_TOKEN_TTL = "180d";

const normalizeBaseUrl = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const getFrontendBaseUrl = () => normalizeBaseUrl(FRONTEND_URL) || "http://localhost:3000";

const getPublicApiBaseUrl = () => {
  const candidates = [
    process.env.PUBLIC_API_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.API_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  const candidate = candidates[0];
  return candidate.endsWith("/api") ? candidate : `${candidate}/api`;
};

const buildEmailPreferencesToken = (
  { email, userId = null, list = DEFAULT_LIST_KEY },
  { expiresIn = DEFAULT_TOKEN_TTL } = {}
) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error("A valid email is required to build email preferences links.");
  }

  return signJwt(
    {
      purpose: EMAIL_PREFERENCE_PURPOSE,
      list,
      email: normalizedEmail,
      uid: userId ? String(userId) : undefined,
    },
    { expiresIn }
  );
};

const parseEmailPreferencesToken = (token, expectedList = DEFAULT_LIST_KEY) => {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    throw new Error("Email preferences token is required.");
  }

  let payload;

  try {
    payload = verifyJwt(normalizedToken);
  } catch (error) {
    throw new Error("This email preferences link is invalid or expired.");
  }

  const normalizedEmail = normalizeEmail(payload?.email || "");
  const list = String(payload?.list || "").trim() || DEFAULT_LIST_KEY;

  if (payload?.purpose !== EMAIL_PREFERENCE_PURPOSE || !normalizedEmail) {
    throw new Error("This email preferences link is invalid or expired.");
  }

  if (expectedList && list !== expectedList) {
    throw new Error("This email preferences link is invalid or expired.");
  }

  return {
    email: normalizedEmail,
    userId: payload?.uid ? String(payload.uid) : null,
    list,
  };
};

const buildEmailPreferencesUrl = ({ email, userId = null, list = DEFAULT_LIST_KEY, action = "" }) => {
  const url = new URL(`${getFrontendBaseUrl()}/email-preferences`);
  url.searchParams.set(
    "token",
    buildEmailPreferencesToken({
      email,
      userId,
      list,
    })
  );

  if (action) {
    url.searchParams.set("action", action);
  }

  return url.toString();
};

const buildEmailPreferencesApiUnsubscribeUrl = ({
  email,
  userId = null,
  list = DEFAULT_LIST_KEY,
} = {}) => {
  const apiBaseUrl = getPublicApiBaseUrl();

  if (!apiBaseUrl) {
    return null;
  }

  const url = new URL(`${apiBaseUrl}/email-preferences/unsubscribe`);
  url.searchParams.set(
    "token",
    buildEmailPreferencesToken({
      email,
      userId,
      list,
    })
  );
  return url.toString();
};

const buildMarketingEmailHeaders = ({ email, userId = null } = {}) => {
  const unsubscribeApiUrl = buildEmailPreferencesApiUnsubscribeUrl({
    email,
    userId,
    list: DEFAULT_LIST_KEY,
  });
  const preferencesUrl = buildEmailPreferencesUrl({
    email,
    userId,
    list: DEFAULT_LIST_KEY,
    action: "unsubscribe",
  });

  const listUnsubscribeEntries = [unsubscribeApiUrl, preferencesUrl]
    .filter(Boolean)
    .map((value) => `<${value}>`);

  if (!listUnsubscribeEntries.length) {
    return {};
  }

  const headers = {
    "List-Unsubscribe": listUnsubscribeEntries.join(", "),
  };

  if (unsubscribeApiUrl) {
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return headers;
};

module.exports = {
  DEFAULT_LIST_KEY,
  buildEmailPreferencesApiUnsubscribeUrl,
  buildEmailPreferencesToken,
  buildEmailPreferencesUrl,
  buildMarketingEmailHeaders,
  getFrontendBaseUrl,
  getPublicApiBaseUrl,
  parseEmailPreferencesToken,
};

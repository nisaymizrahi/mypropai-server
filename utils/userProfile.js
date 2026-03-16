const LEGAL_VERSIONS = {
  terms: '2026-03-16',
  privacy: '2026-03-16',
  marketing: '2026-03-16',
};

const normalizeWhitespace = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeOptionalString = (value, maxLength = 160) => {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.slice(0, maxLength) : '';
};

const normalizeNamePart = (value) => normalizeOptionalString(value, 80);

const normalizePhoneNumber = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\d+()\-. /\s]/g, '')
    .replace(/\s+/g, ' ');

  return normalized ? normalized.slice(0, 40) : '';
};

const splitFullName = (value) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName = '', ...rest] = normalized.split(' ');
  return {
    firstName: normalizeNamePart(firstName),
    lastName: normalizeNamePart(rest.join(' ')),
  };
};

const getResolvedNameParts = (user = {}) => {
  const firstName = normalizeNamePart(user.firstName);
  const lastName = normalizeNamePart(user.lastName);

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  return splitFullName(user.name || '');
};

const buildDisplayName = (user = {}) => {
  const { firstName, lastName } = getResolvedNameParts(user);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }

  return normalizeOptionalString(user.name, 120) || normalizeOptionalString(user.email, 120) || 'Unnamed user';
};

const hasRequiredProfileFields = (user = {}) => {
  const { firstName, lastName } = getResolvedNameParts(user);
  return Boolean(firstName && lastName && normalizeOptionalString(user.email, 320));
};

const buildConsentSummary = (user = {}) => ({
  termsAccepted: Boolean(user.termsAcceptedAt && user.termsVersion),
  termsAcceptedAt: user.termsAcceptedAt || null,
  termsVersion: user.termsVersion || null,
  privacyAccepted: Boolean(user.privacyAcceptedAt && user.privacyVersion),
  privacyAcceptedAt: user.privacyAcceptedAt || null,
  privacyVersion: user.privacyVersion || null,
  marketingOptIn: Boolean(user.marketingConsent),
  marketingConsentAcceptedAt: user.marketingConsentAcceptedAt || null,
  marketingConsentRevokedAt: user.marketingConsentRevokedAt || null,
  marketingConsentVersion: user.marketingConsentVersion || null,
});

const buildAuthProviders = (user = {}) => {
  const hasGoogle = Boolean(user.googleId);
  const hasPassword = Boolean(user.hasPassword || !hasGoogle);

  return {
    google: hasGoogle,
    password: hasPassword,
    label: hasGoogle && hasPassword ? 'Google + password' : hasGoogle ? 'Google' : 'Password',
  };
};

const isProfileCompletionRequired = (user = {}) => {
  if (user.profileCompletionRequired) {
    return true;
  }

  if (!user.googleId) {
    return false;
  }

  const consent = buildConsentSummary(user);
  return !hasRequiredProfileFields(user) || !consent.termsAccepted || !consent.privacyAccepted;
};

const applyProfileFields = (user, fields = {}) => {
  if (!user) {
    return user;
  }

  const hasField = (key) =>
    Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined;

  let nextNameParts = getResolvedNameParts(user);

  if (hasField('name') && !hasField('firstName') && !hasField('lastName')) {
    nextNameParts = splitFullName(fields.name);
  }

  if (hasField('firstName')) {
    nextNameParts.firstName = normalizeNamePart(fields.firstName);
  }

  if (hasField('lastName')) {
    nextNameParts.lastName = normalizeNamePart(fields.lastName);
  }

  user.firstName = nextNameParts.firstName;
  user.lastName = nextNameParts.lastName;
  user.name = buildDisplayName({
    firstName: user.firstName,
    lastName: user.lastName,
    name: hasField('name') ? fields.name : user.name,
    email: user.email,
  });

  if (hasField('companyName')) {
    user.companyName = normalizeOptionalString(fields.companyName, 160) || null;
  }

  if (hasField('phoneNumber')) {
    user.phoneNumber = normalizePhoneNumber(fields.phoneNumber) || null;
  }

  return user;
};

const applyRequiredLegalAcceptance = (user, now = new Date()) => {
  if (!user) {
    return user;
  }

  user.termsAcceptedAt = now;
  user.termsVersion = LEGAL_VERSIONS.terms;
  user.privacyAcceptedAt = now;
  user.privacyVersion = LEGAL_VERSIONS.privacy;
  return user;
};

const applyMarketingConsent = (user, optedIn, now = new Date()) => {
  if (!user) {
    return user;
  }

  if (optedIn) {
    user.marketingConsent = true;
    user.marketingConsentAcceptedAt = now;
    user.marketingConsentRevokedAt = null;
    user.marketingConsentVersion = LEGAL_VERSIONS.marketing;
    return user;
  }

  if (user.marketingConsent) {
    user.marketingConsentRevokedAt = now;
  }

  user.marketingConsent = false;
  return user;
};

module.exports = {
  LEGAL_VERSIONS,
  applyMarketingConsent,
  applyProfileFields,
  applyRequiredLegalAcceptance,
  buildAuthProviders,
  buildConsentSummary,
  buildDisplayName,
  getResolvedNameParts,
  hasRequiredProfileFields,
  isProfileCompletionRequired,
  normalizeOptionalString,
  normalizePhoneNumber,
  splitFullName,
};

const normalizeEmail = (email = '') => String(email || '').trim().toLowerCase();

const parseEmailList = (...values) =>
  values
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((email) => normalizeEmail(email))
    .filter(Boolean);

const getPlatformManagerEmails = () =>
  new Set(
    parseEmailList(
      process.env.PLATFORM_MANAGER_EMAILS,
      process.env.PLATFORM_MANAGER_EMAIL,
      process.env.OWNER_EMAIL,
      process.env.ADMIN_EMAIL
    )
  );

const isPlatformManagerEmail = (email) => {
  const allowedEmails = getPlatformManagerEmails();
  return allowedEmails.size > 0 && allowedEmails.has(normalizeEmail(email));
};

const isPlatformManager = (user) => isPlatformManagerEmail(user?.email);

module.exports = {
  getPlatformManagerEmails,
  isPlatformManager,
  isPlatformManagerEmail,
  normalizeEmail,
};

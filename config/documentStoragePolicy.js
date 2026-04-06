const MB = 1024 * 1024;
const GB = 1024 * MB;

const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const DOCUMENT_STORAGE_TIERS = {
  free: {
    key: 'free',
    label: 'Free',
    totalStorageQuotaBytes: 250 * MB,
    maxFileSizeBytes: 10 * MB,
  },
  starter: {
    key: 'starter',
    label: 'Starter',
    totalStorageQuotaBytes: 2 * GB,
    maxFileSizeBytes: 25 * MB,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    totalStorageQuotaBytes: 10 * GB,
    maxFileSizeBytes: 50 * MB,
  },
};

const resolveDocumentStorageTierKey = (planKey) => {
  const normalized = String(planKey || 'free').trim().toLowerCase();

  if (normalized === 'pro') {
    return 'pro';
  }

  if (normalized === 'starter' || normalized === 'paid') {
    return 'starter';
  }

  return 'free';
};

const getDocumentStorageTier = (planKey) =>
  DOCUMENT_STORAGE_TIERS[resolveDocumentStorageTierKey(planKey)] || DOCUMENT_STORAGE_TIERS.free;

module.exports = {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_STORAGE_TIERS,
  GB,
  MB,
  getDocumentStorageTier,
  resolveDocumentStorageTierKey,
};

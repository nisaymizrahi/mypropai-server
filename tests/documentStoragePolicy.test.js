const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOCUMENT_ALLOWED_MIME_TYPES,
  getDocumentStorageTier,
  resolveDocumentStorageTierKey,
} = require('../config/documentStoragePolicy');
const {
  assertAllowedDocumentFile,
  buildStorageOverview,
  resolveStoragePlan,
} = require('../utils/documentStorageService');

test('storage tier resolution maps current app plans and future paid aliases correctly', () => {
  assert.equal(resolveDocumentStorageTierKey('free'), 'free');
  assert.equal(resolveDocumentStorageTierKey('pro'), 'pro');
  assert.equal(resolveDocumentStorageTierKey('starter'), 'starter');
  assert.equal(resolveDocumentStorageTierKey('paid'), 'starter');
  assert.equal(resolveDocumentStorageTierKey('unknown'), 'free');
});

test('storage tiers expose expected quota defaults', () => {
  assert.equal(getDocumentStorageTier('free').totalStorageQuotaBytes, 250 * 1024 * 1024);
  assert.equal(getDocumentStorageTier('pro').maxFileSizeBytes, 50 * 1024 * 1024);
  assert.equal(getDocumentStorageTier('starter').totalStorageQuotaBytes, 2 * 1024 * 1024 * 1024);
});

test('allowed mime types are restricted to safe document/image formats', () => {
  assert.equal(DOCUMENT_ALLOWED_MIME_TYPES.has('application/pdf'), true);
  assert.equal(DOCUMENT_ALLOWED_MIME_TYPES.has('image/webp'), true);
  assert.equal(DOCUMENT_ALLOWED_MIME_TYPES.has('application/javascript'), false);
  assert.equal(DOCUMENT_ALLOWED_MIME_TYPES.has('video/mp4'), false);
});

test('buildStorageOverview returns usage math for the current plan', () => {
  const overview = buildStorageOverview({
    subscriptionPlan: 'free',
    subscriptionStatus: 'inactive',
    documentStorage: {
      bytesUsed: 100,
      fileCount: 2,
    },
  });

  assert.equal(overview.planKey, 'free');
  assert.equal(overview.bytesUsed, 100);
  assert.equal(overview.fileCount, 2);
  assert.equal(overview.bytesRemaining, overview.totalStorageQuotaBytes - 100);
});

test('resolveStoragePlan honors starter-style active subscriptions for document limits', () => {
  const plan = resolveStoragePlan({
    subscriptionPlan: 'starter',
    subscriptionStatus: 'active',
    documentStorage: {
      bytesUsed: 0,
      fileCount: 0,
    },
  });

  assert.equal(plan.accountPlanKey, 'starter');
  assert.equal(plan.totalStorageQuotaBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(plan.maxFileSizeBytes, 25 * 1024 * 1024);
});

test('assertAllowedDocumentFile rejects unsupported mime types', () => {
  assert.throws(
    () =>
      assertAllowedDocumentFile({
        user: { subscriptionPlan: 'pro', subscriptionStatus: 'active' },
        file: { mimetype: 'application/javascript', size: 100 },
      }),
    /Unsupported file type/
  );
});

test('assertAllowedDocumentFile rejects per-plan file sizes', () => {
  assert.throws(
    () =>
      assertAllowedDocumentFile({
        user: {
          subscriptionPlan: 'free',
          subscriptionStatus: 'inactive',
          documentStorage: { bytesUsed: 0, fileCount: 0 },
        },
        file: {
          mimetype: 'application/pdf',
          size: 11 * 1024 * 1024,
        },
      }),
    /maximum file size is 10.0 MB/
  );
});

test('assertAllowedDocumentFile rejects uploads that would exceed quota', () => {
  assert.throws(
    () =>
      assertAllowedDocumentFile({
        user: {
          subscriptionPlan: 'free',
          subscriptionStatus: 'inactive',
          documentStorage: { bytesUsed: 249 * 1024 * 1024, fileCount: 1 },
        },
        file: {
          mimetype: 'application/pdf',
          size: 5 * 1024 * 1024,
        },
      }),
    /would exceed your storage limit/
  );
});

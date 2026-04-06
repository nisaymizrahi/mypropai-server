const { Readable } = require('stream');

const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const DocumentAsset = require('../models/DocumentAsset');
const User = require('../models/User');
const { getEffectiveSubscriptionState } = require('./billingAccess');
const {
  DOCUMENT_ALLOWED_MIME_TYPES,
  getDocumentStorageTier,
} = require('../config/documentStoragePolicy');

const DOCUMENT_ACCESS_URL_TTL_SECONDS = Number.parseInt(
  process.env.DOCUMENT_ACCESS_URL_TTL_SECONDS || '300',
  10
);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

class DocumentStorageError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DocumentStorageError';
    this.status = options.status || 400;
    this.code = options.code || 'document_storage_error';
  }
}

const toObjectIdOrNull = (value) =>
  mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;

const sanitizeSegment = (value, fallback = 'unknown') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
};

const resolveStoragePlan = (user) => {
  const effectiveSubscription = getEffectiveSubscriptionState(user);
  const rawPlanKey = String(user?.subscriptionPlan || '').trim().toLowerCase();
  const hasActiveRawStarterPlan =
    ACTIVE_SUBSCRIPTION_STATUSES.has(String(user?.subscriptionStatus || '').trim().toLowerCase()) &&
    (rawPlanKey === 'starter' || rawPlanKey === 'paid');
  const storagePlanKey = hasActiveRawStarterPlan
    ? rawPlanKey
    : effectiveSubscription.planKey;
  const tier = getDocumentStorageTier(storagePlanKey);

  return {
    ...tier,
    accountPlanKey: storagePlanKey,
  };
};

const getCurrentUsage = (user) => ({
  bytesUsed: Number(user?.documentStorage?.bytesUsed || 0),
  fileCount: Number(user?.documentStorage?.fileCount || 0),
});

const bytesToHumanLabel = (bytes) => {
  const safeBytes = Number(bytes || 0);
  if (safeBytes >= 1024 * 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  if (safeBytes >= 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (safeBytes >= 1024) {
    return `${(safeBytes / 1024).toFixed(1)} KB`;
  }

  return `${safeBytes} B`;
};

const buildStorageOverview = (user) => {
  const plan = resolveStoragePlan(user);
  const usage = getCurrentUsage(user);
  const bytesRemaining = Math.max(plan.totalStorageQuotaBytes - usage.bytesUsed, 0);

  return {
    planKey: plan.accountPlanKey,
    tierKey: plan.key,
    tierLabel: plan.label,
    totalStorageQuotaBytes: plan.totalStorageQuotaBytes,
    maxFileSizeBytes: plan.maxFileSizeBytes,
    allowedMimeTypes: [...DOCUMENT_ALLOWED_MIME_TYPES],
    bytesUsed: usage.bytesUsed,
    fileCount: usage.fileCount,
    bytesRemaining,
    quotaUsedPercentage:
      plan.totalStorageQuotaBytes > 0
        ? Math.min(Math.round((usage.bytesUsed / plan.totalStorageQuotaBytes) * 100), 100)
        : 0,
    labels: {
      totalStorageQuota: bytesToHumanLabel(plan.totalStorageQuotaBytes),
      maxFileSize: bytesToHumanLabel(plan.maxFileSizeBytes),
      bytesUsed: bytesToHumanLabel(usage.bytesUsed),
      bytesRemaining: bytesToHumanLabel(bytesRemaining),
    },
  };
};

const assertAllowedDocumentFile = ({ user, file }) => {
  if (!file) {
    throw new DocumentStorageError('No file uploaded.', { status: 400, code: 'missing_file' });
  }

  if (!DOCUMENT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new DocumentStorageError(
      'Unsupported file type. Upload a PDF, JPG, PNG, or WEBP file.',
      { status: 400, code: 'unsupported_type' }
    );
  }

  const plan = resolveStoragePlan(user);
  if (Number(file.size || 0) > plan.maxFileSizeBytes) {
    throw new DocumentStorageError(
      `This file is too large for your plan. The maximum file size is ${bytesToHumanLabel(
        plan.maxFileSizeBytes
      )}.`,
      { status: 413, code: 'file_too_large' }
    );
  }

  const { bytesUsed } = getCurrentUsage(user);
  if (bytesUsed + Number(file.size || 0) > plan.totalStorageQuotaBytes) {
    throw new DocumentStorageError(
      `This upload would exceed your storage limit. You have ${bytesToHumanLabel(
        Math.max(plan.totalStorageQuotaBytes - bytesUsed, 0)
      )} remaining on your ${plan.label} plan.`,
      { status: 403, code: 'quota_exceeded' }
    );
  }

  return plan;
};

const buildFolder = ({ ownerAccountId, source, relatedEntityType, relatedEntityId }) => {
  const segments = [
    'accounts',
    sanitizeSegment(ownerAccountId, 'account'),
    'documents',
    sanitizeSegment(source, 'general'),
  ];

  if (relatedEntityType) {
    segments.push(sanitizeSegment(relatedEntityType, 'entity'));
  }

  if (relatedEntityId) {
    segments.push(sanitizeSegment(relatedEntityId, 'record'));
  }

  return segments.join('/');
};

const uploadBufferToCloudinary = ({ file, uploadOptions }) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    Readable.from(file.buffer).pipe(stream);
  });

const claimUsage = async ({ userId, bytes, quotaBytes }) => {
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $expr: {
        $lte: [
          {
            $add: [{ $ifNull: ['$documentStorage.bytesUsed', 0] }, Number(bytes || 0)],
          },
          Number(quotaBytes || 0),
        ],
      },
    },
    {
      $inc: {
        'documentStorage.bytesUsed': Number(bytes || 0),
        'documentStorage.fileCount': 1,
      },
      $set: {
        'documentStorage.lastReconciledAt': new Date(),
      },
    },
    { new: true }
  );

  return Boolean(updatedUser);
};

const releaseUsage = async ({ userId, bytes }) => {
  if (!userId) {
    return;
  }

  await User.updateOne(
    { _id: userId },
    [
      {
        $set: {
          'documentStorage.bytesUsed': {
            $max: [
              {
                $subtract: [{ $ifNull: ['$documentStorage.bytesUsed', 0] }, Number(bytes || 0)],
              },
              0,
            ],
          },
          'documentStorage.fileCount': {
            $max: [{ $subtract: [{ $ifNull: ['$documentStorage.fileCount', 0] }, 1] }, 0],
          },
          'documentStorage.lastReconciledAt': '$$NOW',
        },
      },
    ]
  );
};

const deleteCloudinaryAsset = async ({
  publicId,
  resourceType = 'raw',
  deliveryType = 'authenticated',
}) => {
  if (!publicId) {
    return null;
  }

  const attempts = [
    { publicId, resource_type: resourceType, type: deliveryType, invalidate: true },
    { publicId, resource_type: resourceType, type: 'upload', invalidate: true },
    { publicId, resource_type: 'raw', type: 'upload', invalidate: true },
    { publicId, resource_type: 'image', type: 'upload', invalidate: true },
  ];

  for (const attempt of attempts) {
    try {
      const result = await cloudinary.uploader.destroy(attempt.publicId, attempt);
      if (result?.result === 'ok' || result?.result === 'not found') {
        return result;
      }
    } catch (error) {
      if (attempt === attempts[attempts.length - 1]) {
        throw error;
      }
    }
  }

  return null;
};

const createDocumentAsset = async ({
  user,
  file,
  displayName,
  source,
  documentCategory = '',
  relatedEntityType = '',
  relatedEntityId = '',
  relatedRefs = {},
}) => {
  const plan = assertAllowedDocumentFile({ user, file });

  const folder = buildFolder({
    ownerAccountId: user._id,
    source,
    relatedEntityType,
    relatedEntityId,
  });

  const uploadResult = await uploadBufferToCloudinary({
    file,
    uploadOptions: {
      folder,
      public_id: `doc_${nanoid(14)}`,
      overwrite: false,
      resource_type: file.mimetype.startsWith('image/') ? 'image' : 'raw',
      type: 'authenticated',
      use_filename: false,
      unique_filename: true,
      invalidate: true,
      tags: [
        'fliprop',
        'documents',
        `account_${String(user._id)}`,
        `source_${source}`,
      ],
      context: {
        ownerUserId: String(user._id),
        source,
        relatedEntityType: relatedEntityType || '',
        relatedEntityId: relatedEntityId || '',
        displayName: displayName || file.originalname || '',
      },
    },
  });

  const actualBytes = Number(uploadResult?.bytes || file.size || 0);
  const usageClaimed = await claimUsage({
    userId: user._id,
    bytes: actualBytes,
    quotaBytes: plan.totalStorageQuotaBytes,
  });

  if (!usageClaimed) {
    await deleteCloudinaryAsset({
      publicId: uploadResult.public_id,
      resourceType: uploadResult.resource_type,
      deliveryType: uploadResult.type || 'authenticated',
    }).catch(() => null);

    throw new DocumentStorageError(
      `This upload would exceed your storage limit. Upgrade your plan or remove old files before uploading another document.`,
      { status: 403, code: 'quota_exceeded' }
    );
  }

  try {
    const asset = await DocumentAsset.create({
      ownerAccount: user._id,
      uploadedBy: user._id,
      provider: 'cloudinary',
      source,
      publicId: uploadResult.public_id,
      secureUrl: uploadResult.secure_url || uploadResult.url,
      assetId: uploadResult.asset_id || '',
      resourceType: uploadResult.resource_type || (file.mimetype.startsWith('image/') ? 'image' : 'raw'),
      deliveryType: uploadResult.type || 'authenticated',
      bytes: actualBytes,
      version: Number(uploadResult.version || 0) || null,
      format: uploadResult.format || '',
      originalFilename: file.originalname || '',
      mimeType: file.mimetype || '',
      displayName: displayName || file.originalname || '',
      folder: uploadResult.folder || folder,
      documentCategory,
      planKeyAtUpload: plan.accountPlanKey,
      relatedEntityType,
      relatedEntityId,
      investment: relatedRefs.investment || null,
      managedProperty: relatedRefs.managedProperty || null,
      unit: relatedRefs.unit || null,
      vendor: relatedRefs.vendor || null,
    });

    return {
      asset,
      plan,
      uploadResult,
    };
  } catch (error) {
    await deleteCloudinaryAsset({
      publicId: uploadResult.public_id,
      resourceType: uploadResult.resource_type,
      deliveryType: uploadResult.type || 'authenticated',
    }).catch(() => null);
    await releaseUsage({ userId: user._id, bytes: actualBytes }).catch(() => null);
    throw error;
  }
};

const rollbackDocumentAssetCreation = async ({ assetId, userId, bytes }) => {
  const asset = assetId ? await DocumentAsset.findById(assetId) : null;

  if (asset) {
    await deleteCloudinaryAsset({
      publicId: asset.publicId,
      resourceType: asset.resourceType,
      deliveryType: asset.deliveryType,
    }).catch(() => null);
    await DocumentAsset.deleteOne({ _id: asset._id }).catch(() => null);
  }

  if (userId && bytes) {
    await releaseUsage({ userId, bytes }).catch(() => null);
  }
};

const markDocumentAssetLinked = async ({ assetId, sourceRecordId }) => {
  if (!assetId || !sourceRecordId) return;

  await DocumentAsset.updateOne(
    { _id: assetId },
    {
      $set: {
        sourceRecordId: String(sourceRecordId),
      },
    }
  );
};

const buildAccessUrl = (asset, options = {}) => {
  if (!asset?.publicId) {
    return '';
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) +
    (Number.isFinite(DOCUMENT_ACCESS_URL_TTL_SECONDS)
      ? DOCUMENT_ACCESS_URL_TTL_SECONDS
      : 300);

  if (asset.deliveryType === 'authenticated') {
    return cloudinary.utils.private_download_url(asset.publicId, asset.format || undefined, {
      resource_type: asset.resourceType || 'raw',
      type: asset.deliveryType,
      expires_at: expiresAt,
      attachment: options.download ? asset.originalFilename || true : undefined,
      secure: true,
    });
  }

  return asset.secureUrl;
};

const getAssetAccessPayloadForUser = async ({ assetId, userId, download = false }) => {
  if (!mongoose.Types.ObjectId.isValid(assetId)) {
    throw new DocumentStorageError('Document asset not found.', {
      status: 404,
      code: 'asset_not_found',
    });
  }

  const asset = await DocumentAsset.findById(assetId).lean();
  if (!asset) {
    throw new DocumentStorageError('Document asset not found.', {
      status: 404,
      code: 'asset_not_found',
    });
  }

  if (String(asset.ownerAccount) !== String(userId)) {
    throw new DocumentStorageError('You are not authorized to access this document.', {
      status: 403,
      code: 'asset_forbidden',
    });
  }

  return {
    assetId: String(asset._id),
    url: buildAccessUrl(asset, { download }),
    expiresAt: new Date(
      Date.now() +
        (Number.isFinite(DOCUMENT_ACCESS_URL_TTL_SECONDS)
          ? DOCUMENT_ACCESS_URL_TTL_SECONDS * 1000
          : 300000)
    ).toISOString(),
  };
};

const reconcileDocumentStorageUsageForUser = async (userId) => {
  const ownerAccountId = toObjectIdOrNull(userId);
  if (!ownerAccountId) {
    return { bytesUsed: 0, fileCount: 0 };
  }

  const [summary] = await DocumentAsset.aggregate([
    {
      $match: {
        ownerAccount: ownerAccountId,
      },
    },
    {
      $group: {
        _id: null,
        bytesUsed: { $sum: '$bytes' },
        fileCount: { $sum: 1 },
      },
    },
  ]);

  const nextUsage = {
    bytesUsed: Number(summary?.bytesUsed || 0),
    fileCount: Number(summary?.fileCount || 0),
  };

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'documentStorage.bytesUsed': nextUsage.bytesUsed,
        'documentStorage.fileCount': nextUsage.fileCount,
        'documentStorage.lastReconciledAt': new Date(),
      },
    }
  );

  return nextUsage;
};

const buildOpsSummaryForUser = async (user) => {
  const overview = buildStorageOverview(user);
  const assets = await DocumentAsset.find({ ownerAccount: user._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  const largestFiles = await DocumentAsset.find({ ownerAccount: user._id })
    .sort({ bytes: -1, createdAt: -1 })
    .limit(5)
    .lean();

  return {
    ...overview,
    recentUploads: assets.map((asset) => ({
      id: String(asset._id),
      displayName: asset.displayName || asset.originalFilename || 'Untitled file',
      bytes: asset.bytes,
      bytesLabel: bytesToHumanLabel(asset.bytes),
      source: asset.source,
      relatedEntityType: asset.relatedEntityType,
      relatedEntityId: asset.relatedEntityId,
      createdAt: asset.createdAt,
    })),
    largestFiles: largestFiles.map((asset) => ({
      id: String(asset._id),
      displayName: asset.displayName || asset.originalFilename || 'Untitled file',
      bytes: asset.bytes,
      bytesLabel: bytesToHumanLabel(asset.bytes),
      source: asset.source,
      relatedEntityType: asset.relatedEntityType,
      relatedEntityId: asset.relatedEntityId,
      createdAt: asset.createdAt,
    })),
  };
};

module.exports = {
  DocumentStorageError,
  assertAllowedDocumentFile,
  buildAccessUrl,
  buildOpsSummaryForUser,
  buildStorageOverview,
  bytesToHumanLabel,
  createDocumentAsset,
  deleteCloudinaryAsset,
  getAssetAccessPayloadForUser,
  markDocumentAssetLinked,
  reconcileDocumentStorageUsageForUser,
  releaseUsage,
  resolveStoragePlan,
  rollbackDocumentAssetCreation,
};

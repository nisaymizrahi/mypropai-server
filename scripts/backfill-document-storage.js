require('dotenv').config();

const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const connectDB = require('../config/db');
const DocumentAsset = require('../models/DocumentAsset');
const ProjectDocument = require('../models/ProjectDocument');
const UnitDocument = require('../models/UnitDocument');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const {
  markDocumentAssetLinked,
  reconcileDocumentStorageUsageForUser,
  resolveStoragePlan,
} = require('../utils/documentStorageService');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const getResourceCandidates = (record = {}) => {
  const candidates = [];
  const hintedResourceType = String(record.resourceType || '').trim();
  const hintedDeliveryType = String(record.deliveryType || '').trim();

  if (hintedResourceType || hintedDeliveryType) {
    candidates.push({
      resource_type: hintedResourceType || 'raw',
      type: hintedDeliveryType || 'authenticated',
    });
  }

  candidates.push(
    { resource_type: 'raw', type: 'authenticated' },
    { resource_type: 'raw', type: 'upload' },
    { resource_type: 'image', type: 'authenticated' },
    { resource_type: 'image', type: 'upload' }
  );

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.resource_type}:${candidate.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const resolveCloudinaryResource = async (publicId, record = {}) => {
  for (const candidate of getResourceCandidates(record)) {
    try {
      const resource = await cloudinary.api.resource(publicId, candidate);
      return {
        resource,
        candidate,
      };
    } catch (error) {
      if (error?.http_code === 404) {
        continue;
      }
    }
  }

  return null;
};

const upsertDocumentAsset = async ({
  ownerAccount,
  uploadedBy,
  source,
  sourceRecordId,
  displayName,
  category,
  relatedEntityType,
  relatedEntityId,
  publicId,
  fallbackUrl,
  originalFilename,
  mimeType,
  relatedRefs = {},
  record = {},
}) => {
  const existingAsset = await DocumentAsset.findOne({ publicId });
  if (existingAsset) {
    await markDocumentAssetLinked({
      assetId: existingAsset._id,
      sourceRecordId,
    });
    return existingAsset;
  }

  const cloudinaryData = publicId ? await resolveCloudinaryResource(publicId, record) : null;
  const resource = cloudinaryData?.resource || null;
  const user = await User.findById(ownerAccount).select('subscriptionPlan subscriptionStatus platformSubscriptionOverride platformSubscriptionOverrideExpiresAt');
  const plan = resolveStoragePlan(user);

  return DocumentAsset.create({
    ownerAccount,
    uploadedBy,
    provider: 'cloudinary',
    source,
    sourceRecordId: sourceRecordId ? String(sourceRecordId) : '',
    publicId,
    secureUrl: resource?.secure_url || fallbackUrl || '',
    assetId: resource?.asset_id || record.cloudinaryAssetId || '',
    resourceType: resource?.resource_type || record.resourceType || 'raw',
    deliveryType: resource?.type || record.deliveryType || 'authenticated',
    bytes: Number(resource?.bytes || record.fileBytes || 0),
    version: Number(resource?.version || record.cloudinaryVersion || 0) || null,
    format: resource?.format || record.cloudinaryFormat || '',
    originalFilename: originalFilename || record.originalFilename || '',
    mimeType: mimeType || record.mimeType || '',
    displayName: displayName || '',
    folder: resource?.folder || '',
    documentCategory: category || '',
    planKeyAtUpload: plan.accountPlanKey,
    relatedEntityType,
    relatedEntityId: relatedEntityId ? String(relatedEntityId) : '',
    investment: relatedRefs.investment || null,
    managedProperty: relatedRefs.managedProperty || null,
    unit: relatedRefs.unit || null,
    vendor: relatedRefs.vendor || null,
    createdAt: record.createdAt || new Date(),
    updatedAt: record.updatedAt || new Date(),
  });
};

const backfillProjectDocuments = async () => {
  const docs = await ProjectDocument.find({
    cloudinaryId: { $exists: true, $ne: '' },
    $or: [{ documentAsset: null }, { documentAsset: { $exists: false } }],
  });

  for (const doc of docs) {
    const asset = await upsertDocumentAsset({
      ownerAccount: doc.ownerAccount || doc.user,
      uploadedBy: doc.user,
      source: 'project_document',
      sourceRecordId: doc._id,
      displayName: doc.displayName,
      category: doc.category,
      relatedEntityType: 'investment',
      relatedEntityId: doc.investment,
      publicId: doc.cloudinaryId,
      fallbackUrl: doc.secureUrl || doc.fileUrl,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      relatedRefs: {
        investment: doc.investment,
      },
      record: doc,
    });

    doc.ownerAccount = doc.ownerAccount || doc.user;
    doc.documentAsset = asset._id;
    doc.secureUrl = doc.secureUrl || asset.secureUrl;
    doc.cloudinaryAssetId = doc.cloudinaryAssetId || asset.assetId;
    doc.resourceType = doc.resourceType || asset.resourceType;
    doc.deliveryType = doc.deliveryType || asset.deliveryType;
    doc.fileBytes = doc.fileBytes || asset.bytes;
    doc.originalFilename = doc.originalFilename || asset.originalFilename;
    doc.mimeType = doc.mimeType || asset.mimeType;
    doc.cloudinaryVersion = doc.cloudinaryVersion || asset.version;
    doc.cloudinaryFormat = doc.cloudinaryFormat || asset.format;
    await doc.save();
  }
};

const backfillUnitDocuments = async () => {
  const docs = await UnitDocument.find({
    cloudinaryId: { $exists: true, $ne: '' },
    $or: [{ documentAsset: null }, { documentAsset: { $exists: false } }],
  });

  for (const doc of docs) {
    const asset = await upsertDocumentAsset({
      ownerAccount: doc.ownerAccount || doc.uploadedBy,
      uploadedBy: doc.uploadedBy,
      source: 'managed_document',
      sourceRecordId: doc._id,
      displayName: doc.displayName,
      category: doc.unit ? 'Unit' : 'Property',
      relatedEntityType: doc.unit ? 'unit' : 'managed_property',
      relatedEntityId: doc.unit || doc.property,
      publicId: doc.cloudinaryId,
      fallbackUrl: doc.secureUrl || doc.fileUrl,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      relatedRefs: {
        managedProperty: doc.property,
        unit: doc.unit,
      },
      record: doc,
    });

    doc.ownerAccount = doc.ownerAccount || doc.uploadedBy;
    doc.documentAsset = asset._id;
    doc.secureUrl = doc.secureUrl || asset.secureUrl;
    doc.cloudinaryAssetId = doc.cloudinaryAssetId || asset.assetId;
    doc.resourceType = doc.resourceType || asset.resourceType;
    doc.deliveryType = doc.deliveryType || asset.deliveryType;
    doc.fileBytes = doc.fileBytes || asset.bytes;
    doc.originalFilename = doc.originalFilename || asset.originalFilename;
    doc.mimeType = doc.mimeType || asset.mimeType;
    doc.cloudinaryVersion = doc.cloudinaryVersion || asset.version;
    doc.cloudinaryFormat = doc.cloudinaryFormat || asset.format;
    await doc.save();
  }
};

const backfillVendorDocuments = async () => {
  const vendors = await Vendor.find({
    'documents.cloudinaryId': { $exists: true, $ne: '' },
  });

  for (const vendor of vendors) {
    let changed = false;

    for (const document of vendor.documents || []) {
      if (document.documentAsset || !document.cloudinaryId) {
        continue;
      }

      const asset = await upsertDocumentAsset({
        ownerAccount: document.ownerAccount || vendor.user,
        uploadedBy: document.ownerAccount || vendor.user,
        source: 'vendor_document',
        sourceRecordId: document._id,
        displayName: document.displayName,
        category: document.category,
        relatedEntityType: 'vendor',
        relatedEntityId: vendor._id,
        publicId: document.cloudinaryId,
        fallbackUrl: document.secureUrl || document.fileUrl,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        relatedRefs: {
          vendor: vendor._id,
        },
        record: document,
      });

      document.ownerAccount = document.ownerAccount || vendor.user;
      document.documentAsset = asset._id;
      document.secureUrl = document.secureUrl || asset.secureUrl;
      document.cloudinaryAssetId = document.cloudinaryAssetId || asset.assetId;
      document.resourceType = document.resourceType || asset.resourceType;
      document.deliveryType = document.deliveryType || asset.deliveryType;
      document.fileBytes = document.fileBytes || asset.bytes;
      document.originalFilename = document.originalFilename || asset.originalFilename;
      document.mimeType = document.mimeType || asset.mimeType;
      document.cloudinaryVersion = document.cloudinaryVersion || asset.version;
      document.cloudinaryFormat = document.cloudinaryFormat || asset.format;
      changed = true;
    }

    if (changed) {
      await vendor.save();
    }
  }
};

const run = async () => {
  await connectDB();

  await backfillProjectDocuments();
  await backfillUnitDocuments();
  await backfillVendorDocuments();

  const owners = await DocumentAsset.distinct('ownerAccount');
  for (const ownerId of owners) {
    await reconcileDocumentStorageUsageForUser(ownerId);
  }

  console.log('[document-storage] Backfill complete.');
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('[document-storage] Backfill failed:', error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});

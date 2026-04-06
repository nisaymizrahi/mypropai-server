// controllers/unitDocumentController.js

const Unit = require('../models/Unit');
const ManagedProperty = require('../models/ManagedProperty');
const UnitDocument = require('../models/UnitDocument');
const DocumentAsset = require('../models/DocumentAsset');
const {
  createDocumentAsset,
  deleteCloudinaryAsset,
  DocumentStorageError,
  markDocumentAssetLinked,
  releaseUsage,
  rollbackDocumentAssetCreation,
} = require('../utils/documentStorageService');

// Upload document to a specific unit
exports.uploadUnitDocument = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { displayName } = req.body;

    if (!req.file || !displayName) {
      return res.status(400).json({ msg: 'Missing file or display name' });
    }

    const unit = await Unit.findById(unitId).populate('property');
    if (!unit || unit.property.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    const { asset } = await createDocumentAsset({
      user: req.user,
      file: req.file,
      displayName,
      source: 'managed_document',
      documentCategory: 'Unit',
      relatedEntityType: 'unit',
      relatedEntityId: unitId,
      relatedRefs: {
        managedProperty: unit.property?._id || unit.property,
        unit: unit._id,
      },
    });

    const newDoc = new UnitDocument({
      unit: unitId,
      property: unit.property?._id || unit.property,
      uploadedBy: req.user.id,
      ownerAccount: req.user.id,
      displayName,
      documentAsset: asset._id,
      fileUrl: asset.secureUrl,
      cloudinaryId: asset.publicId,
      secureUrl: asset.secureUrl,
      cloudinaryAssetId: asset.assetId,
      resourceType: asset.resourceType,
      deliveryType: asset.deliveryType,
      fileBytes: asset.bytes,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      cloudinaryVersion: asset.version,
      cloudinaryFormat: asset.format,
    });

    try {
      await newDoc.save();
    } catch (saveError) {
      await rollbackDocumentAssetCreation({
        assetId: asset._id,
        userId: req.user.id,
        bytes: asset.bytes,
      }).catch(() => null);
      throw saveError;
    }

    await markDocumentAssetLinked({
      assetId: asset._id,
      sourceRecordId: newDoc._id,
    }).catch((linkError) => {
      console.error('Unit document asset link update failed:', linkError);
    });

    res.status(201).json(newDoc);
  } catch (err) {
    if (err instanceof DocumentStorageError) {
      return res.status(err.status).json({ msg: err.message, code: err.code });
    }
    console.error('Upload Unit Document Error:', err);
    res.status(500).json({ msg: 'Server error uploading unit document' });
  }
};

// Upload property-level document (not tied to a unit)
exports.uploadPropertyDocument = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { displayName } = req.body;

    if (!req.file || !displayName) {
      return res.status(400).json({ msg: 'Missing file or display name' });
    }

    const property = await ManagedProperty.findById(propertyId);
    if (!property || property.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    const { asset } = await createDocumentAsset({
      user: req.user,
      file: req.file,
      displayName,
      source: 'managed_document',
      documentCategory: 'Property',
      relatedEntityType: 'managed_property',
      relatedEntityId: propertyId,
      relatedRefs: {
        managedProperty: property._id,
      },
    });

    const newDoc = new UnitDocument({
      unit: null,
      uploadedBy: req.user.id,
      ownerAccount: req.user.id,
      displayName,
      documentAsset: asset._id,
      fileUrl: asset.secureUrl,
      cloudinaryId: asset.publicId,
      secureUrl: asset.secureUrl,
      cloudinaryAssetId: asset.assetId,
      resourceType: asset.resourceType,
      deliveryType: asset.deliveryType,
      fileBytes: asset.bytes,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      cloudinaryVersion: asset.version,
      cloudinaryFormat: asset.format,
      property: propertyId
    });

    try {
      await newDoc.save();
    } catch (saveError) {
      await rollbackDocumentAssetCreation({
        assetId: asset._id,
        userId: req.user.id,
        bytes: asset.bytes,
      }).catch(() => null);
      throw saveError;
    }

    await markDocumentAssetLinked({
      assetId: asset._id,
      sourceRecordId: newDoc._id,
    }).catch((linkError) => {
      console.error('Property document asset link update failed:', linkError);
    });

    res.status(201).json(newDoc);
  } catch (err) {
    if (err instanceof DocumentStorageError) {
      return res.status(err.status).json({ msg: err.message, code: err.code });
    }
    console.error('Upload Property Document Error:', err);
    res.status(500).json({ msg: 'Server error uploading property document' });
  }
};

// Get all documents for a specific unit
exports.getUnitDocuments = async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.unitId).populate('property');
    if (!unit || unit.property.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    const docs = await UnitDocument.find({ unit: unit._id });
    res.json(docs);
  } catch (err) {
    console.error('Get Unit Documents Error:', err);
    res.status(500).json({ msg: 'Server error fetching unit documents' });
  }
};

// Get all documents for a property (property-level + all units)
exports.getPropertyDocuments = async (req, res) => {
  try {
    const property = await ManagedProperty.findById(req.params.propertyId).populate('units');
    if (!property || property.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    const allDocs = await UnitDocument.find({
      $or: [
        { unit: { $in: property.units } },
        { unit: null, property: property._id }
      ]
    }).populate('unit');

    const grouped = {
      propertyWide: [],
      byUnit: {}
    };

    allDocs.forEach(doc => {
      if (!doc.unit) {
        grouped.propertyWide.push(doc);
      } else {
        const key = doc.unit._id;
        if (!grouped.byUnit[key]) grouped.byUnit[key] = [];
        grouped.byUnit[key].push(doc);
      }
    });

    res.json(grouped);
  } catch (err) {
    console.error('Get Property Documents Error:', err);
    res.status(500).json({ msg: 'Server error fetching documents' });
  }
};

// Delete any document (unit or property)
exports.deleteDocument = async (req, res) => {
  try {
    const doc = await UnitDocument.findById(req.params.docId).populate({
      path: 'unit',
      populate: { path: 'property' }
    });

    if (!doc) return res.status(404).json({ msg: 'Document not found' });

    const userId = doc.unit ? doc.unit.property.user.toString() : doc.uploadedBy.toString();
    if (userId !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    const asset = doc.documentAsset ? await DocumentAsset.findById(doc.documentAsset) : null;

    if (doc.cloudinaryId || asset?.publicId) {
      await deleteCloudinaryAsset({
        publicId: asset?.publicId || doc.cloudinaryId,
        resourceType: asset?.resourceType || doc.resourceType || 'raw',
        deliveryType: asset?.deliveryType || doc.deliveryType || 'authenticated',
      });
    }

    await doc.deleteOne();
    if (asset) {
      await DocumentAsset.deleteOne({ _id: asset._id });
      await releaseUsage({
        userId: doc.ownerAccount || doc.uploadedBy,
        bytes: asset.bytes,
      });
    } else if (doc.fileBytes) {
      await releaseUsage({
        userId: doc.ownerAccount || doc.uploadedBy,
        bytes: doc.fileBytes,
      });
    }

    res.json({ msg: 'Document deleted successfully' });
  } catch (err) {
    if (err instanceof DocumentStorageError) {
      return res.status(err.status).json({ msg: err.message, code: err.code });
    }
    console.error('Delete Document Error:', err);
    res.status(500).json({ msg: 'Server error deleting document' });
  }
};

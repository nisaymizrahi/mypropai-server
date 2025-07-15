// controllers/unitDocumentController.js

const Unit = require('../models/Unit');
const ManagedProperty = require('../models/ManagedProperty');
const UnitDocument = require('../models/UnitDocument');
const cloudinary = require('cloudinary').v2;

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

    const newDoc = new UnitDocument({
      unit: unitId,
      uploadedBy: req.user.id,
      displayName,
      fileUrl: req.file.path,
      cloudinaryId: req.file.filename,
    });

    await newDoc.save();
    res.status(201).json(newDoc);
  } catch (err) {
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

    const newDoc = new UnitDocument({
      unit: null,
      uploadedBy: req.user.id,
      displayName,
      fileUrl: req.file.path,
      cloudinaryId: req.file.filename,
      property: propertyId
    });

    await newDoc.save();
    res.status(201).json(newDoc);
  } catch (err) {
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

    if (doc.cloudinaryId) {
      await cloudinary.uploader.destroy(doc.cloudinaryId);
    }

    await doc.deleteOne();
    res.json({ msg: 'Document deleted successfully' });
  } catch (err) {
    console.error('Delete Document Error:', err);
    res.status(500).json({ msg: 'Server error deleting document' });
  }
};

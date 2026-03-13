const mongoose = require('mongoose');

const UnitDocumentSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedProperty', default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  cloudinaryId: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('UnitDocument', UnitDocumentSchema);

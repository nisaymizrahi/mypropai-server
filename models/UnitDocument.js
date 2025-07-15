const mongoose = require('mongoose');

const UnitDocumentSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  cloudinaryId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UnitDocument', UnitDocumentSchema);

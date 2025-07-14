const mongoose = require('mongoose');

const MaintenanceTicketSchema = new mongoose.Schema({
  // Link to the user who owns the property
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The property this ticket belongs to
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManagedProperty',
    required: true,
  },
  // The specific unit, if applicable
  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
  },
  // The tenant who submitted the request
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
  },
  title: {
    type: String,
    required: [true, 'A title is required for the maintenance ticket.'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['New', 'In Progress', 'Awaiting Parts', 'On Hold', 'Complete'],
    default: 'New',
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
  },
  // The contractor assigned to this job
  assignedVendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
  },
  // Store photos related to the maintenance issue
  photos: [{
    url: { type: String, required: true },
    cloudinaryId: { type: String, required: true },
  }],
}, { timestamps: true });

module.exports = mongoose.model('MaintenanceTicket', MaintenanceTicketSchema);
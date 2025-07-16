const mongoose = require('mongoose');

const ApplicationSchema = new mongoose.Schema({
  // Link to the user who owns this application
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The property this application is for
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManagedProperty',
    required: true,
  },
  // The specific unit this application is for
  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
  },
  // Applicant's personal information
  applicantInfo: {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    dateOfBirth: { type: Date },
  },
  // Residence History
  residenceHistory: [{
    address: String,
    landlordName: String,
    landlordPhone: String,
    reasonForLeaving: String,
    rentAmount: Number,
    duration: String, // e.g., "2 years"
  }],
  // Employment & Income
  employmentHistory: [{
    employer: String,
    position: String,
    supervisorName: String,
    supervisorPhone: String,
    monthlyIncome: Number,
    duration: String,
  }],
  // Application status
  status: {
    type: String,
    enum: ['Pending Payment', 'Pending Screening', 'Under Review', 'Approved', 'Denied', 'Withdrawn'],
    default: 'Pending Payment',
  },
  // A flag to indicate if the application fee has been paid
  feePaid: {
    type: Boolean,
    default: false,
  },
  // Store the ID of the Stripe payment intent for reference
  stripePaymentIntentId: {
    type: String,
  },
  // Placeholder for the screening report ID from our partner service
  screeningReportId: {
    type: String,
  }
}, { timestamps: true });

module.exports = mongoose.model('Application', ApplicationSchema);
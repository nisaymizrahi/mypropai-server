const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  // Link to the managed property this tenant belongs to
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManagedProperty',
    required: true
  },
  // The landlord/user who owns this tenant record
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // --- Core Tenant Information ---
  fullName: { 
    type: String, 
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  contactNotes: String,

  // --- NEW: Fields to support a future Tenant Portal ---
  email: {
    type: String,
    required: true,
    unique: true, // Ensures no two tenants can have the same login email
    trim: true,
    lowercase: true // Standardizes email for easier login
  },
  password: { // This will be a hashed password, set upon tenant registration
    type: String
  },
  // You could use this status to manage their portal access
  portalStatus: {
    type: String,
    enum: ['Invited', 'Active', 'Disabled'],
    default: 'Disabled' 
  }

}, { timestamps: true });

module.exports = mongoose.model('Tenant', TenantSchema);
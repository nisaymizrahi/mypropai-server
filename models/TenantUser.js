const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const TenantUserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email address',
    ],
  },
  password: {
    type: String,
    // Password is not required until the invitation is accepted
  },
  // Link to the main Tenant model which holds name, phone, etc.
  tenantInfo: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Tenant',
  },
  // For the initial email invitation to set a password
  invitationToken: String,
  invitationExpires: Date,
  
  // For future "Forgot Password" functionality
  passwordResetToken: String,
  passwordResetExpires: Date,
}, { timestamps: true });

// Middleware: Before saving a user, hash the password if it has been modified
TenantUserSchema.pre('save', async function(next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) {
    return next();
  }

  // Hash the password with a cost of 12
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

// Instance Method: Compare candidate password with the hashed password in the DB
TenantUserSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('TenantUser', TenantUserSchema);
const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const Lease = require('../models/Lease');
const TenantUser = require('../models/TenantUser');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const sendEmail = require('../utils/sendEmail');

// @desc    Promote an Investment to a ManagedProperty
exports.promoteInvestment = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.investmentId);
    if (!investment) return res.status(404).json({ msg: 'Investment not found' });
    if (investment.user.toString() !== req.user.id) return res.status(401).json({ msg: 'User not authorized' });
    if (investment.type !== 'rent') return res.status(400).json({ msg: 'Only "Fix and Rent" properties can be managed.' });
    if (investment.managedProperty) return res.status(400).json({ msg: 'This property is already being managed.' });

    const managedProperty = new ManagedProperty({
      investment: investment._id,
      user: req.user.id,
      address: investment.address,
    });

    const defaultUnit = new Unit({
      property: managedProperty._id,
      name: investment.unitCount > 1 ? 'Unit 1' : 'Main Unit',
      status: 'Vacant'
    });

    managedProperty.units.push(defaultUnit._id);
    investment.managedProperty = managedProperty._id;

    await managedProperty.save();
    await defaultUnit.save();
    await investment.save();
    res.status(201).json(managedProperty);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get all managed properties for a user
exports.getManagedProperties = async (req, res) => {
  try {
    const properties = await ManagedProperty.find({ user: req.user.id }).populate('units').sort({ createdAt: -1 });
    res.json(properties);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get "Fix and Rent" investments that are not yet managed
exports.getUnmanagedProperties = async (req, res) => {
  try {
    const unmanaged = await Investment.find({ user: req.user.id, type: 'rent', managedProperty: null }).select('address');
    res.json(unmanaged);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get a single managed property by its ID
exports.getManagedPropertyById = async (req, res) => {
  try {
    const property = await ManagedProperty.findById(req.params.propertyId)
      .populate({ path: 'units', populate: { path: 'currentLease', populate: { path: 'tenant' } } })
      .populate('investment');
    if (!property) return res.status(404).json({ msg: 'Property not found' });
    if (property.user.toString() !== req.user.id) return res.status(401).json({ msg: 'User not authorized' });
    res.json(property);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Add a new unit to a managed property
exports.addUnitToProperty = async (req, res) => {
  const { name, beds, baths, sqft } = req.body;
  try {
    const property = await ManagedProperty.findById(req.params.propertyId);
    if (!property) return res.status(404).json({ msg: 'Property not found' });
    if (property.user.toString() !== req.user.id) return res.status(401).json({ msg: 'User not authorized' });
    const newUnit = new Unit({ property: req.params.propertyId, name, beds, baths, sqft, status: 'Vacant' });
    await newUnit.save();
    property.units.push(newUnit._id);
    await property.save();
    res.status(201).json(newUnit);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc   Add a Tenant and a Lease to a specific Unit
// 2. THIS ENTIRE FUNCTION IS REPLACED
exports.addLeaseToUnit = async (req, res) => {
  const { unitId } = req.params;
  const { fullName, email, phone, contactNotes, startDate, endDate, rentAmount, securityDeposit, leaseNotes } = req.body;

  if (!fullName || !email || !startDate || !endDate || !rentAmount) {
    return res.status(400).json({ msg: 'Please provide all required tenant and lease information.' });
  }

  // Check if a tenant login already exists with this email
  const existingTenantUser = await TenantUser.findOne({ email });
  if (existingTenantUser) {
    return res.status(400).json({ msg: 'A tenant login account with this email already exists.' });
  }

  try {
    const unit = await Unit.findById(unitId);
    if (!unit) return res.status(404).json({ msg: 'Unit not found.' });
    if (unit.status !== 'Vacant') return res.status(400).json({ msg: 'This unit is already occupied.' });

    const property = await ManagedProperty.findById(unit.property);
    if (property.user.toString() !== req.user.id) return res.status(401).json({ msg: 'User not authorized.' });

    const newTenant = new Tenant({ property: unit.property, user: req.user.id, fullName, email, phone, contactNotes });
    await newTenant.save();
    
    // --- START: New Tenant Invitation Logic ---
    try {
        const tenantUser = new TenantUser({
            email,
            tenantInfo: newTenant._id,
        });

        const invitationToken = crypto.randomBytes(32).toString('hex');
        tenantUser.invitationToken = invitationToken;
        tenantUser.invitationExpires = Date.now() + 48 * 60 * 60 * 1000; // 48 hours from now

        await tenantUser.save({ validateBeforeSave: false }); // Save without password validation for now

        // For now, we log the invite URL. Later, we will email this.
        const inviteURL = `${process.env.FRONTEND_URL}/invite/${invitationToken}`;
        console.log('--- Tenant Invitation ---');
        console.log(`Generated for: ${email}`);
        console.log(`URL: ${inviteURL}`);
        console.log('-------------------------');

    } catch(err) {
        console.error('Error creating tenant user invitation:', err);
        // This part is not critical to the lease creation, so we won't stop the whole process,
        // but we should be aware of the failure.
    }
    // --- END: New Tenant Invitation Logic ---

    const newLease = new Lease({
      unit: unitId,
      tenant: newTenant._id,
      startDate,
      endDate,
      rentAmount,
      securityDeposit,
      notes: leaseNotes,
      transactions: []
    });
    await newLease.save();

    unit.currentLease = newLease._id;
    unit.status = 'Occupied';
    await unit.save();
    res.status(201).json({ tenant: newTenant, lease: newLease });
  } catch (err) {
    console.error(err.message);
    // Check for a duplicate key error on the main Tenant model as well
    if (err.code === 11000) return res.status(400).json({ msg: 'A tenant with this email already exists.' });
    res.status(500).send('Server Error');
  }
};

// @desc    Get a single lease by its ID
exports.getLeaseById = async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.leaseId).populate('tenant');
    if (!lease || !lease.tenant) {
      return res.status(401).json({ msg: 'Not authorized or lease not found' });
    }
    if (lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }
    const finalLease = await Lease.findById(req.params.leaseId)
      .populate('tenant')
      .populate({
        path: 'unit',
        populate: { path: 'property', select: 'address' }
      });
    res.json(finalLease);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Add a transaction to a lease's ledger
exports.addTransactionToLease = async (req, res) => {
  const { leaseId } = req.params;
  const { date, type, description, amount } = req.body;

  if (!date || !type || !amount) {
    return res.status(400).json({ msg: 'Date, type, and amount are required.' });
  }
  try {
    const lease = await Lease.findById(leaseId).populate('tenant');
    if (!lease || !lease.tenant) {
      return res.status(404).json({ msg: 'Lease not found.' });
    }
    if (lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized.' });
    }
    lease.transactions.push({ date, type, description, amount: Number(amount) });
    await lease.save();
    res.status(201).json(lease.transactions[lease.transactions.length - 1]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// ✅ Automatically apply recurring charges
exports.runRecurringChargesForToday = async (req, res) => {
  try {
    const today = new Date();
    const day = today.getDate();

    const leases = await Lease.find({
      isActive: true,
      recurringCharges: { $exists: true, $ne: [] }
    });

    let addedCount = 0;

    for (const lease of leases) {
      const tenant = await Tenant.findById(lease.tenant);
      if (!tenant || tenant.user.toString() !== req.user.id) continue;

      for (const recurring of lease.recurringCharges) {
        if (recurring.dayOfMonth !== day) continue;

        const alreadyCharged = lease.transactions.some(tx => {
          const txDate = new Date(tx.date);
          return (
            txDate.getDate() === day &&
            txDate.getMonth() === today.getMonth() &&
            txDate.getFullYear() === today.getFullYear() &&
            tx.type === recurring.type &&
            tx.description === recurring.description &&
            tx.amount === recurring.amount
          );
        });

        if (!alreadyCharged) {
          lease.transactions.push({
            date: today,
            type: recurring.type,
            description: recurring.description,
            amount: -Math.abs(recurring.amount)
          });
          addedCount++;
        }
      }

      await lease.save();
    }

    res.json({ message: `Recurring charges run completed. ${addedCount} charges added.` });
  } catch (err) {
    console.error('Error running recurring charges:', err);
    res.status(500).json({ error: 'Failed to process recurring charges' });
  }
};

// ✅ Updated: PATCH /leases/:leaseId to add recurring charges safely
exports.updateLease = async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.leaseId).populate('tenant');
    if (!lease || lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Unauthorized' });
    }

    // --- 1. Update tenant fields ---
    const tenantUpdates = req.body.tenantUpdates || {};
    if (tenantUpdates.fullName !== undefined) lease.tenant.fullName = tenantUpdates.fullName;
    if (tenantUpdates.email !== undefined) lease.tenant.email = tenantUpdates.email;
    if (tenantUpdates.phone !== undefined) lease.tenant.phone = tenantUpdates.phone;
    await lease.tenant.save();

    // --- 2. Update lease term fields ---
    const leaseUpdates = req.body.leaseTermUpdates || {};
    if (leaseUpdates.startDate !== undefined) lease.startDate = leaseUpdates.startDate;
    if (leaseUpdates.endDate !== undefined) lease.endDate = leaseUpdates.endDate;
    if (leaseUpdates.rentAmount !== undefined) lease.rentAmount = leaseUpdates.rentAmount;
    if (leaseUpdates.securityDeposit !== undefined) lease.securityDeposit = leaseUpdates.securityDeposit;

    // --- 3. Replace recurring charges if provided ---
    if (req.body.recurringCharges) {
      const charges = req.body.recurringCharges;

      if (!Array.isArray(charges)) {
        return res.status(400).json({ msg: 'recurringCharges must be an array' });
      }

      const allowedTypes = ['Rent Charge', 'Late Fee', 'Pet Fee', 'Renters Insurance', 'Utility Fee', 'Parking Fee', 'Other Charge'];

      for (const charge of charges) {
        if (
          typeof charge.dayOfMonth !== 'number' ||
          charge.dayOfMonth < 1 || charge.dayOfMonth > 28
        ) {
          return res.status(400).json({ msg: 'Invalid dayOfMonth (must be 1–28)' });
        }

        if (!allowedTypes.includes(charge.type)) {
          return res.status(400).json({ msg: `Invalid type: ${charge.type}` });
        }

        if (typeof charge.description !== 'string' || !charge.description.trim()) {
          return res.status(400).json({ msg: 'Description is required' });
        }

        if (typeof charge.amount !== 'number' || isNaN(charge.amount)) {
          return res.status(400).json({ msg: 'Amount must be a number' });
        }
      }

      lease.recurringCharges = charges; 
    }

    await lease.save();

    res.status(200).json(lease);
  } catch (err) {
    console.error('Update Lease Error:', err);
    res.status(500).json({ msg: 'Server error updating lease' });
  }
};
exports.addLeaseToUnit = async (req, res) => {
  const { unitId } = req.params;
  const { fullName, email, phone, contactNotes, startDate, endDate, rentAmount, securityDeposit, leaseNotes } = req.body;

  if (!fullName || !email || !startDate || !endDate || !rentAmount) {
    return res.status(400).json({ msg: 'Please provide all required tenant and lease information.' });
  }

  const existingTenantUser = await TenantUser.findOne({ email });
  if (existingTenantUser) {
    return res.status(400).json({ msg: 'A tenant login account with this email already exists.' });
  }

  try {
    const unit = await Unit.findById(unitId);
    if (!unit) return res.status(404).json({ msg: 'Unit not found.' });
    if (unit.status !== 'Vacant') return res.status(400).json({ msg: 'This unit is already occupied.' });

    const property = await ManagedProperty.findById(unit.property);
    if (property.user.toString() !== req.user.id) return res.status(401).json({ msg: 'User not authorized.' });

    const newTenant = new Tenant({ property: unit.property, user: req.user.id, fullName, email, phone, contactNotes });
    await newTenant.save();
    
    // Auto-create invitation but don't email yet. We'll use the button for that.
    try {
        const tenantUser = new TenantUser({ email, tenantInfo: newTenant._id });
        const invitationToken = crypto.randomBytes(32).toString('hex');
        tenantUser.invitationToken = invitationToken;
        tenantUser.invitationExpires = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
        await tenantUser.save({ validateBeforeSave: false });
    } catch(err) {
        console.error('Error auto-creating tenant user:', err);
    }

    const newLease = new Lease({
      unit: unitId,
      tenant: newTenant._id,
      startDate,
      endDate,
      rentAmount,
      securityDeposit,
      notes: leaseNotes,
      transactions: []
    });
    await newLease.save();

    unit.currentLease = newLease._id;
    unit.status = 'Occupied';
    await unit.save();
    res.status(201).json({ tenant: newTenant, lease: newLease });
  } catch (err) {
    console.error(err.message);
    if (err.code === 11000) return res.status(400).json({ msg: 'A tenant with this email already exists.' });
    res.status(500).send('Server Error');
  }
};


// ... (all your other functions like getLeaseById, addTransactionToLease, etc. remain here) ...


// ✅ NEW: Function to send a tenant portal invitation email
exports.sendTenantInvite = async (req, res) => {
    try {
        const { leaseId } = req.params;
        const lease = await Lease.findById(leaseId).populate('tenant');

        if (!lease || !lease.tenant) {
            return res.status(404).json({ msg: 'Lease or tenant not found.' });
        }

        // Find the corresponding TenantUser account by email
        let tenantUser = await TenantUser.findOne({ email: lease.tenant.email });

        // If a tenant was added before we built this system, create their account now
        if (!tenantUser) {
            tenantUser = new TenantUser({
                email: lease.tenant.email,
                tenantInfo: lease.tenant._id,
            });
        }

        // Generate a fresh, secure invitation token and set its expiry
        const invitationToken = crypto.randomBytes(32).toString('hex');
        tenantUser.invitationToken = invitationToken;
        tenantUser.invitationExpires = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
        await tenantUser.save();

        // Create the invitation URL
        const inviteURL = `${process.env.FRONTEND_URL}/invite/${invitationToken}`;

        // Create the email message
        const message = `
            <h1>You're Invited to Your Tenant Portal!</h1>
            <p>Hello ${lease.tenant.fullName},</p>
            <p>You have been invited to create an account for your tenant portal for the property at ${lease.unit.property.address}.</p>
            <p>Please click the link below to set your password and access your account. This link is valid for 48 hours.</p>
            <a href="${inviteURL}" style="background-color: #14B8A6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Set Your Password</a>
            <p>If you did not request this, please ignore this email.</p>
        `;

        // Use our email utility to send the email
        await sendEmail({
            to: lease.tenant.email,
            subject: 'Your Tenant Portal Invitation',
            html: message,
        });

        res.status(200).json({ msg: 'Invitation email sent successfully.' });

    } catch (error) {
        console.error('Error sending tenant invite:', error);
        res.status(500).json({ msg: 'Server error while sending invitation.' });
    }
};

// @desc    Get all communications for a lease
exports.getCommunicationsForLease = async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.leaseId).populate('tenant');
    if (!lease || lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Unauthorized' });
    }

    res.json(lease.communications || []);
  } catch (err) {
    console.error('Error fetching communications:', err);
    res.status(500).json({ msg: 'Server error fetching communications' });
  }
};


// @desc    Add a communication entry to a lease (with optional file upload)
exports.addCommunicationToLease = async (req, res) => {
  console.log('--- ADDING COMMUNICATION ---');
  console.log('Request Body:', req.body);
  console.log('Request File:', req.file);

  try {
    const lease = await Lease.findById(req.params.leaseId).populate('tenant');
    if (!lease || lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Unauthorized' });
    }

    const { subject, notes, category } = req.body;
    if (!subject) {
        console.error('Validation failed: Subject is missing from request body.');
        return res.status(400).json({ msg: 'Subject is required' });
    }

    const newEntry = {
      subject,
      notes,
      category: category || 'Other',
    };

    if (req.file) {
      newEntry.attachmentUrl = req.file.path; 
      newEntry.attachmentCloudinaryId = req.file.filename;
    }

    lease.communications.push(newEntry);
    await lease.save();

    res.status(201).json(lease.communications[lease.communications.length - 1]);
  } catch (err) {
    console.error('Error adding communication:', err);
    res.status(500).json({ msg: 'Server error adding communication' });
  }
};

// @desc    Update the status of a specific communication
exports.updateCommunicationStatus = async (req, res) => {
  try {
    const { leaseId, commId } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['Not Started', 'In Progress', 'Finished', 'Closed'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ msg: 'Invalid status provided.' });
    }

    const lease = await Lease.findById(leaseId).populate('tenant');
    if (!lease || lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Unauthorized' });
    }

    const communication = lease.communications.id(commId);
    if (!communication) {
      return res.status(404).json({ msg: 'Communication entry not found.' });
    }

    communication.status = status;
    await lease.save();

    res.json(communication);
  } catch (err) {
    console.error('Error updating communication status:', err);
    res.status(500).json({ msg: 'Server error updating status' });
  }
};

// @desc    Function to edit a communication's subject and notes
exports.editCommunication = async (req, res) => {
    try {
        const { leaseId, commId } = req.params;
        const { subject, notes } = req.body;

        if(!subject) {
            return res.status(400).json({ msg: 'Subject is required.' });
        }

        const lease = await Lease.findById(leaseId).populate('tenant');
        if (!lease || lease.tenant.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Unauthorized' });
        }

        const communication = lease.communications.id(commId);
        if(!communication) {
            return res.status(404).json({ msg: 'Communication entry not found.' });
        }

        communication.subject = subject;
        communication.notes = notes;
        
        await lease.save();
        res.json(communication);
    } catch (err) {
        console.error('Error editing communication:', err);
        res.status(500).json({ msg: 'Server error editing communication' });
    }
};


// @desc    Delete a specific communication from a lease
exports.deleteCommunicationFromLease = async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.leaseId).populate('tenant');
    if (!lease || lease.tenant.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Unauthorized' });
    }

    const { commId } = req.params;
    
    const communicationToDelete = lease.communications.id(commId);

    if (communicationToDelete && communicationToDelete.attachmentCloudinaryId) {
        await cloudinary.uploader.destroy(communicationToDelete.attachmentCloudinaryId);
    }

    lease.communications = lease.communications.filter(comm => comm._id.toString() !== commId);

    await lease.save();
    res.json({ msg: 'Communication deleted successfully.' });
  } catch (err) {
    console.error('Error deleting communication:', err);
    res.status(500).json({ msg: 'Server error deleting communication' });
  }
};

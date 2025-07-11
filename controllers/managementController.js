const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const Lease = require('../models/Lease');

// @desc    Promote an Investment to a ManagedProperty
exports.promoteInvestment = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.investmentId);

    if (!investment) {
      return res.status(404).json({ msg: 'Investment not found' });
    }
    if (investment.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }
    if (investment.type !== 'rent') {
      return res.status(400).json({ msg: 'Only "Fix and Rent" properties can be managed.' });
    }
    if (investment.managedProperty) {
      return res.status(400).json({ msg: 'This property is already being managed.' });
    }

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
    const properties = await ManagedProperty.find({ user: req.user.id })
      .populate('units') 
      .sort({ createdAt: -1 });
      
    res.json(properties);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get "Fix and Rent" investments that are not yet managed
exports.getUnmanagedProperties = async (req, res) => {
    try {
        const unmanaged = await Investment.find({
            user: req.user.id,
            type: 'rent',
            managedProperty: null 
        }).select('address');

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
            .populate({
                path: 'units',
                populate: {
                    path: 'currentLease',
                    populate: {
                        path: 'tenant'
                    }
                }
            })
            .populate('investment');

        if (!property) {
            return res.status(404).json({ msg: 'Property not found' });
        }
        if (property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

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

        if (!property) {
            return res.status(404).json({ msg: 'Property not found' });
        }
        if (property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        const newUnit = new Unit({
            property: req.params.propertyId,
            name,
            beds,
            baths,
            sqft,
            status: 'Vacant'
        });

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
exports.addLeaseToUnit = async (req, res) => {
    const { unitId } = req.params;
    const { 
        fullName, email, phone, contactNotes,
        startDate, endDate, rentAmount, securityDeposit, leaseNotes 
    } = req.body;

    if (!fullName || !email || !startDate || !endDate || !rentAmount) {
        return res.status(400).json({ msg: 'Please provide all required tenant and lease information.' });
    }

    try {
        const unit = await Unit.findById(unitId);
        if (!unit) {
            return res.status(404).json({ msg: 'Unit not found.' });
        }
        if (unit.status !== 'Vacant') {
            return res.status(400).json({ msg: 'This unit is already occupied.' });
        }
        
        const property = await ManagedProperty.findById(unit.property);
        if (property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        const newTenant = new Tenant({
            property: unit.property,
            user: req.user.id,
            fullName,
            email,
            phone,
            contactNotes
        });
        await newTenant.save();
        
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
        if (err.code === 11000) {
            return res.status(400).json({ msg: 'A tenant with this email already exists.' });
        }
        res.status(500).send('Server Error');
    }
};

// @desc    Get a single lease by its ID
exports.getLeaseById = async (req, res) => {
    try {
        const lease = await Lease.findById(req.params.leaseId)
            .populate('tenant')
            .populate({
                path: 'unit',
                populate: {
                    path: 'property',
                    select: 'address user'
                }
            });

        if (!lease || !lease.unit || !lease.unit.property) {
            return res.status(404).json({ msg: 'Lease or associated property not found' });
        }

        // CORRECTED: This is the definitive authorization check.
        if (lease.unit.property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        res.json(lease);
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
        const lease = await Lease.findById(leaseId).populate({
            path: 'unit',
            populate: { path: 'property', select: 'user' }
        });

        if (!lease || !lease.unit || !lease.unit.property) {
            return res.status(404).json({ msg: 'Lease or associated property not found.' });
        }
        
        // CORRECTED: This is the definitive authorization check.
        if (lease.unit.property.user.toString() !== req.user.id) {
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
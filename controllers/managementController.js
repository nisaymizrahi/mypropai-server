const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant'); // NEW: Import Tenant model
const Lease = require('../models/Lease');   // NEW: Import Lease model

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

// NEW: @desc   Add a Tenant and a Lease to a specific Unit
exports.addLeaseToUnit = async (req, res) => {
    const { unitId } = req.params;
    const { 
        fullName, email, phone, contactNotes, // Tenant info
        startDate, endDate, rentAmount, securityDeposit, leaseNotes // Lease info
    } = req.body;

    // Basic validation
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
        
        // Verify the user owns the parent property
        const property = await ManagedProperty.findById(unit.property);
        if (property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // 1. Create the new Tenant
        const newTenant = new Tenant({
            property: unit.property,
            user: req.user.id,
            fullName,
            email,
            phone,
            contactNotes
        });
        await newTenant.save();
        
        // 2. Create the new Lease, linking the new Tenant
        const newLease = new Lease({
            unit: unitId,
            tenant: newTenant._id,
            startDate,
            endDate,
            rentAmount,
            securityDeposit,
            notes: leaseNotes,
            transactions: [] // Start with an empty ledger
        });
        await newLease.save();

        // 3. Update the Unit to link the new lease and set status to Occupied
        unit.currentLease = newLease._id;
        unit.status = 'Occupied';
        await unit.save();

        res.status(201).json({ tenant: newTenant, lease: newLease });

    } catch (err) {
        console.error(err.message);
        // Handle potential duplicate email error for tenants
        if (err.code === 11000) {
            return res.status(400).json({ msg: 'A tenant with this email already exists.' });
        }
        res.status(500).send('Server Error');
    }
};
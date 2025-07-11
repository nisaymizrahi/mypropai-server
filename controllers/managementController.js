const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');

// @desc    Promote an Investment to a ManagedProperty
exports.promoteInvestment = async (req, res) => {
  try {
    // 1. Find the original investment
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

    // 2. Create the new ManagedProperty
    const managedProperty = new ManagedProperty({
      investment: investment._id,
      user: req.user.id,
      address: investment.address,
    });
    
    // 3. Create a default unit for the property
    const defaultUnit = new Unit({
        property: managedProperty._id,
        name: investment.unitCount > 1 ? 'Unit 1' : 'Main Unit',
        status: 'Vacant'
    });

    // Add the new unit to the managed property's list of units
    managedProperty.units.push(defaultUnit._id);
    
    // 4. Link the new ManagedProperty back to the original Investment
    investment.managedProperty = managedProperty._id;

    // 5. Save everything to the database
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

// NEW: @desc    Get "Fix and Rent" investments that are not yet managed
exports.getUnmanagedProperties = async (req, res) => {
    try {
        const unmanaged = await Investment.find({
            user: req.user.id,
            type: 'rent',
            managedProperty: null // The key filter: only find investments without a management link
        }).select('address'); // We only need the address and ID to display in the list

        res.json(unmanaged);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
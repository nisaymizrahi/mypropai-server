const Application = require('../models/Application');
const Unit = require('../models/Unit');
const ManagedProperty = require('../models/ManagedProperty');

// @desc    Get public details for an application form
exports.getPublicApplicationDetails = async (req, res) => {
    try {
        const unit = await Unit.findById(req.params.unitId).populate('property', 'address user');
        if (!unit) {
            return res.status(404).json({ msg: 'Unit not found.' });
        }
        // In the future, we would pull the application fee from the user's settings.
        // For now, we'll use a placeholder.
        const applicationFee = 50; 
        res.json({
            address: unit.property.address,
            unitName: unit.name,
            applicationFee,
        });
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Submit a new rental application
exports.submitApplication = async (req, res) => {
    try {
        const { unitId, applicantInfo, residenceHistory, employmentHistory } = req.body;
        const unit = await Unit.findById(unitId).populate('property');
        if (!unit) {
            return res.status(404).json({ msg: 'Cannot apply to a non-existent unit.' });
        }

        const newApplication = new Application({
            user: unit.property.user, // The landlord who owns the property
            property: unit.property._id,
            unit: unitId,
            applicantInfo,
            residenceHistory,
            employmentHistory,
        });

        await newApplication.save();
        res.status(201).json(newApplication);

    } catch (error) {
        console.error("Error submitting application:", error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Create a Stripe payment intent for the application fee
exports.createPaymentIntent = async (req, res) => {
    // THIS IS A MOCKED FUNCTION FOR NOW
    try {
        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({ msg: 'Application not found.' });
        }
        
        // In a real scenario, you'd call Stripe here to create a PaymentIntent.
        // For now, we will simulate a successful payment immediately.
        application.feePaid = true;
        application.status = 'Pending Screening';
        await application.save();

        res.json({ clientSecret: 'mock_pi_12345_secret_67890', msg: 'Mock payment successful.' });
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all applications for a specific property
exports.getApplicationsForProperty = async (req, res) => {
    try {
        const property = await ManagedProperty.findById(req.params.propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }
        const applications = await Application.find({ property: req.params.propertyId })
            .populate('unit', 'name')
            .sort({ createdAt: -1 });
        res.json(applications);
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get a single application's full details
exports.getApplicationById = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate('unit', 'name')
            .populate('property', 'address');
        if (!application || application.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }
        res.json(application);
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update the status of an application (e.g., approve, deny)
exports.updateApplicationStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const application = await Application.findById(req.params.id);
        if (!application || application.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }
        application.status = status;
        await application.save();
        res.json(application);
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Initiates the tenant screening process
exports.initiateScreening = async (req, res) => {
    // THIS IS A MOCKED FUNCTION FOR NOW
    try {
        const application = await Application.findById(req.params.id);
        if (!application || application.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }
        if (!application.feePaid) {
            return res.status(400).json({ msg: 'Application fee must be paid before initiating screening.' });
        }

        // In a real scenario, you'd call the TransUnion API here.
        // For now, we'll just update the status and add a mock report ID.
        application.screeningReportId = `mock_report_${new Date().getTime()}`;
        application.status = 'Under Review';
        await application.save();
        
        res.json({ msg: 'Screening process initiated.', application });
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};
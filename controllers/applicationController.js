const Application = require('../models/Application');
const Unit = require('../models/Unit');
const ManagedProperty = require('../models/ManagedProperty');
const User = require('../models/User');
const { consumeMatchingPurchase, getFeatureAccessState } = require('../utils/billingAccess');
const { APPLICATION_FEE_CENTS, getStripeClient } = require('../lib/stripe');

const VALID_MANAGER_DECISIONS = new Set(['Approved', 'Denied']);

const getAuthorizedApplication = async (applicationId, userId) => {
    const application = await Application.findById(applicationId);
    if (!application || application.user.toString() !== userId) {
        return null;
    }

    return application;
};

const createCheckoutSessionForApplication = async (application, unit, owner) => {
    const stripe = getStripeClient();
    if (!stripe) {
        return {
            checkoutUrl: null,
            paymentStatus: 'manual_followup',
            message: 'Payments are not configured yet for this property manager.',
        };
    }

    let paymentsReady = Boolean(owner?.stripeAccountId && owner?.stripeOnboardingComplete);
    if (owner?.stripeAccountId && !paymentsReady) {
        try {
            const connectedAccount = await stripe.accounts.retrieve(owner.stripeAccountId);
            paymentsReady = Boolean(connectedAccount.charges_enabled && connectedAccount.payouts_enabled);

            if (paymentsReady) {
                owner.stripeOnboardingComplete = true;
                await owner.save();
            }
        } catch (error) {
            console.error('Unable to verify connected Stripe account readiness:', error);
        }
    }

    if (!owner?.stripeAccountId || !paymentsReady) {
        return {
            checkoutUrl: null,
            paymentStatus: 'manual_followup',
            message: 'The property manager has not finished setting up secure online payments yet.',
        };
    }

    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    const propertyAddress = unit.property?.address || 'Rental property';
    const unitLabel = unit.name ? ` - ${unit.name}` : '';

    const session = await stripe.checkout.sessions.create(
        {
            mode: 'payment',
            success_url: `${frontendBase}/apply/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontendBase}/apply/${unit._id}?payment=cancelled`,
            customer_email: application.applicantInfo?.email,
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'usd',
                        unit_amount: APPLICATION_FEE_CENTS,
                        product_data: {
                            name: `Rental application fee${unitLabel}`,
                            description: propertyAddress,
                        },
                    },
                },
            ],
            metadata: {
                applicationId: application._id.toString(),
                propertyId: application.property.toString(),
                unitId: application.unit.toString(),
                userId: application.user.toString(),
            },
        },
        {
            stripeAccount: owner.stripeAccountId,
        }
    );

    application.stripeCheckoutSessionId = session.id;
    await application.save();

    return {
        checkoutUrl: session.url,
        paymentStatus: 'checkout_required',
        message: 'Continue to Stripe to finish the application fee.',
    };
};

const markApplicationPaidFromSession = async (session) => {
    const application = await Application.findOne({ stripeCheckoutSessionId: session.id });
    if (!application) {
        return null;
    }

    if (!application.feePaid) {
        application.feePaid = true;
        application.feePaidAt = new Date();
        application.status = 'Pending Screening';
    }

    application.stripePaymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || application.stripePaymentIntentId;

    await application.save();
    return application;
};

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
            applicationFeeCents: APPLICATION_FEE_CENTS,
        });
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Submit a new rental application
exports.submitApplication = async (req, res) => {
    try {
        const { unitId, applicantInfo, residenceHistory, employmentHistory } = req.body;
        if (!unitId || !applicantInfo?.fullName || !applicantInfo?.email || !applicantInfo?.phone) {
            return res.status(400).json({ msg: 'Please complete the required application fields.' });
        }

        const unit = await Unit.findById(unitId).populate('property');
        if (!unit) {
            return res.status(404).json({ msg: 'Cannot apply to a non-existent unit.' });
        }
        if (unit.status !== 'Vacant') {
            return res.status(400).json({ msg: 'Applications are only available for vacant units.' });
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

        const owner = await User.findById(unit.property.user).select('stripeAccountId stripeOnboardingComplete');
        let payment = {
            checkoutUrl: null,
            paymentStatus: 'manual_followup',
            message: 'Your application was received, but we could not start secure payment automatically.',
        };

        try {
            payment = await createCheckoutSessionForApplication(newApplication, unit, owner);
        } catch (paymentError) {
            console.error('Error creating checkout session for application:', paymentError);
        }

        res.status(201).json({
            applicationId: newApplication._id,
            checkoutUrl: payment.checkoutUrl,
            paymentStatus: payment.paymentStatus,
            message: payment.message,
        });

    } catch (error) {
        console.error("Error submitting application:", error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Create a fresh Stripe Checkout session for an existing application
exports.createPaymentIntent = async (req, res) => {
    try {
        const application = await getAuthorizedApplication(req.params.id, req.user.id);
        if (!application) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }

        if (application.feePaid) {
            return res.json({ url: null, msg: 'Application fee is already marked as paid.' });
        }

        const unit = await Unit.findById(application.unit).populate('property');
        if (!unit) {
            return res.status(404).json({ msg: 'Unit not found.' });
        }

        const owner = await User.findById(application.user).select('stripeAccountId stripeOnboardingComplete');
        const payment = await createCheckoutSessionForApplication(application, unit, owner);

        if (!payment.checkoutUrl) {
            return res.status(409).json({ msg: payment.message });
        }

        res.json({ url: payment.checkoutUrl, msg: payment.message });
    } catch (error) {
        console.error('Error creating application checkout session:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Confirm a completed Stripe Checkout session for an application
exports.confirmPaymentSession = async (req, res) => {
    try {
        const stripe = getStripeClient();
        if (!stripe) {
            return res.status(503).json({ msg: 'Payments are not configured on the server.' });
        }

        const application = await Application.findOne({ stripeCheckoutSessionId: req.params.sessionId });
        if (!application) {
            return res.status(404).json({ msg: 'Application payment session not found.' });
        }

        const owner = await User.findById(application.user).select('stripeAccountId');
        if (!owner?.stripeAccountId) {
            return res.status(409).json({ msg: 'The property manager is not connected to Stripe.' });
        }

        const session = await stripe.checkout.sessions.retrieve(
            req.params.sessionId,
            {},
            { stripeAccount: owner.stripeAccountId }
        );

        if (session.payment_status === 'paid') {
            await markApplicationPaidFromSession(session);
        }

        res.json({
            applicationId: application._id,
            feePaid: session.payment_status === 'paid' || application.feePaid,
            paymentStatus: session.payment_status,
        });
    } catch (error) {
        console.error('Error confirming application payment session:', error);
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
        if (!VALID_MANAGER_DECISIONS.has(status)) {
            return res.status(400).json({ msg: 'Invalid application status update.' });
        }

        const application = await getAuthorizedApplication(req.params.id, req.user.id);
        if (!application) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }
        if (application.status !== 'Under Review') {
            return res.status(400).json({ msg: 'Only applications under review can be approved or denied.' });
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
        const application = await getAuthorizedApplication(req.params.id, req.user.id);
        if (!application) {
            return res.status(401).json({ msg: 'Application not found or user not authorized.' });
        }
        if (!application.feePaid) {
            return res.status(400).json({ msg: 'Application fee must be paid before initiating screening.' });
        }
        if (application.status === 'Under Review') {
            return res.json({ msg: 'Screening is already in progress.', application });
        }
        if (application.status !== 'Pending Screening') {
            return res.status(400).json({ msg: 'This application is not ready for screening.' });
        }

        const access = await getFeatureAccessState({
            user: req.user,
            featureKey: 'tenant_screening',
            resourceId: application._id,
        });

        if (!access.accessGranted) {
            return res.status(402).json({
                msg: 'Tenant screening requires a one-time screening purchase for this application.',
                billing: {
                    featureKey: 'tenant_screening',
                    planKey: access.planKey,
                    hasUnusedPurchase: access.hasUnusedPurchase,
                },
            });
        }

        // In a real scenario, you'd call the TransUnion API here.
        // For now, we'll just update the status and add a mock report ID.
        application.screeningReportId = `mock_report_${new Date().getTime()}`;
        application.status = 'Under Review';
        await application.save();

        await consumeMatchingPurchase({
            userId: req.user.id,
            kind: 'tenant_screening',
            resourceId: application._id,
        });
        
        res.json({ msg: 'Screening process initiated.', application });
    } catch (error) {
        res.status(500).json({ msg: 'Server Error' });
    }
};

exports.markApplicationPaidFromSession = markApplicationPaidFromSession;

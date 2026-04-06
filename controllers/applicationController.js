const Application = require('../models/Application');
const Unit = require('../models/Unit');
const ManagedProperty = require('../models/ManagedProperty');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { signJwt, verifyJwt } = require('../utils/jwtConfig');
const { APPLICATION_FEE_CENTS, getStripeClient } = require('../lib/stripe');

const VALID_MANAGER_DECISIONS = new Set(['Approved', 'Denied']);
const VALID_INVITE_SCOPES = new Set(['portfolio', 'property', 'unit']);
const APPLICATION_INVITE_KIND = 'application_invite';
const APPLICATION_INVITE_TTL = '365d';
const FINAL_APPLICATION_STATUSES = new Set(['Approved', 'Denied', 'Withdrawn']);

const normalizeApplicationStatus = (status, feePaid = false) => {
  if (FINAL_APPLICATION_STATUSES.has(status)) {
    return status;
  }

  return feePaid ? 'Under Review' : 'Pending Payment';
};

const normalizeApplicationForWrite = (application) => {
  if (!application) {
    return null;
  }

  application.status = normalizeApplicationStatus(application.status, application.feePaid);
  return application;
};

const serializeApplication = (application) => {
  const record = application?.toObject ? application.toObject() : application;

  return {
    ...record,
    status: normalizeApplicationStatus(record?.status, record?.feePaid),
  };
};

const resolveApplicationFeeCents = (owner) => {
  const feeCents = Number(owner?.applicationFeeCents);

  if (!Number.isFinite(feeCents) || feeCents < 0) {
    return APPLICATION_FEE_CENTS;
  }

  return Math.round(feeCents);
};

const getAuthorizedApplication = async (applicationId, userId) => {
  const application = await Application.findById(applicationId);
  if (!application || application.user.toString() !== userId) {
    return null;
  }

  return normalizeApplicationForWrite(application);
};

const getFrontendBase = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const getOwnerDisplayName = (owner) => owner?.name || owner?.email || 'the property manager';

const buildApplicationContextSummary = ({ scope, propertyAddress, unitName }) => {
  if (scope === 'unit') {
    return {
      title: unitName ? `Apply for ${unitName}` : 'Apply for this rental',
      summary: propertyAddress
        ? `Complete this rental application for ${propertyAddress}.`
        : 'Complete this rental application for the invited unit.',
    };
  }

  if (scope === 'property') {
    return {
      title: propertyAddress ? `Apply for ${propertyAddress}` : 'Apply for this property',
      summary:
        'Complete this rental application for the selected property. A specific unit can be assigned during review.',
    };
  }

  return {
    title: 'Complete a rental application',
    summary:
      'Complete a general rental application for this property manager. Property or unit placement can be assigned later.',
  };
};

const buildApplicationRecordSummary = (application) => ({
  propertyAddress:
    application.property?.address || application.propertyAddressSnapshot || 'Portfolio-wide application',
  unitName:
    application.unit?.name ||
    application.unitNameSnapshot ||
    (application.applicationScope === 'property' ? 'No unit selected' : 'General application'),
});

const buildInviteToken = ({ ownerId, scope, propertyId = null, unitId = null }) =>
  signJwt(
    {
      kind: APPLICATION_INVITE_KIND,
      ownerId: String(ownerId),
      scope,
      propertyId: propertyId ? String(propertyId) : null,
      unitId: unitId ? String(unitId) : null,
    },
    { expiresIn: APPLICATION_INVITE_TTL }
  );

const buildPublicApplicationUrl = ({ inviteToken = null, unitId = null }) => {
  const frontendBase = getFrontendBase();

  if (inviteToken) {
    return `${frontendBase}/apply?invite=${encodeURIComponent(inviteToken)}`;
  }

  if (unitId) {
    return `${frontendBase}/apply/${unitId}`;
  }

  return `${frontendBase}/apply`;
};

const buildPublicCancelUrl = ({ inviteToken = null, unitId = null }) => {
  const baseUrl = buildPublicApplicationUrl({ inviteToken, unitId });
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}payment=cancelled`;
};

const verifyInviteToken = (inviteToken) => {
  if (!inviteToken) {
    throw Object.assign(new Error('This application link is invalid.'), { status: 400 });
  }

  try {
    const payload = verifyJwt(inviteToken);

    if (payload?.kind !== APPLICATION_INVITE_KIND || !payload?.ownerId) {
      throw new Error('Invalid invite payload.');
    }

    return payload;
  } catch (error) {
    throw Object.assign(new Error('This application link is invalid or has expired.'), {
      status: 400,
    });
  }
};

const resolveLegacyUnitContext = async (unitId) => {
  const unit = await Unit.findById(unitId).populate('property', 'address user');
  if (!unit || !unit.property?.user) {
    throw Object.assign(new Error('This application link is no longer available.'), { status: 404 });
  }

  const owner = await User.findById(unit.property.user).select(
    'name email stripeAccountId stripeOnboardingComplete applicationFeeCents'
  );

  if (!owner) {
    throw Object.assign(new Error('The property manager for this application could not be found.'), {
      status: 404,
    });
  }

  return {
    owner,
    property: unit.property,
    unit,
    scope: 'unit',
    inviteToken: null,
  };
};

const resolveInviteContext = async (inviteToken) => {
  const payload = verifyInviteToken(inviteToken);
  const owner = await User.findById(payload.ownerId).select(
    'name email stripeAccountId stripeOnboardingComplete applicationFeeCents'
  );

  if (!owner) {
    throw Object.assign(new Error('The property manager for this application could not be found.'), {
      status: 404,
    });
  }

  let property = null;
  let unit = null;
  let scope = VALID_INVITE_SCOPES.has(payload.scope) ? payload.scope : 'portfolio';

  if (payload.unitId) {
    unit = await Unit.findById(payload.unitId).populate('property', 'address user');
    if (!unit || !unit.property || unit.property.user.toString() !== payload.ownerId) {
      throw Object.assign(new Error('This application link is no longer available.'), { status: 404 });
    }

    property = unit.property;
    scope = 'unit';
  } else if (payload.propertyId) {
    property = await ManagedProperty.findById(payload.propertyId).select('address user');
    if (!property || property.user.toString() !== payload.ownerId) {
      throw Object.assign(new Error('This application link is no longer available.'), { status: 404 });
    }

    scope = 'property';
  }

  return {
    owner,
    property,
    unit,
    scope,
    inviteToken,
  };
};

const resolvePublicApplicationContext = async ({ inviteToken = null, unitId = null }) => {
  if (inviteToken) {
    return resolveInviteContext(inviteToken);
  }

  if (unitId) {
    return resolveLegacyUnitContext(unitId);
  }

  throw Object.assign(new Error('This application link is invalid.'), { status: 400 });
};

const createCheckoutSessionForApplication = async (
  application,
  owner,
  { property = null, unit = null, inviteToken = null, unitId = null, cancelUrl = null } = {}
) => {
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

  const frontendBase = getFrontendBase();
  const applicationFeeCents = resolveApplicationFeeCents(owner);
  const propertyAddress = property?.address || application.propertyAddressSnapshot || 'Rental application';
  const unitName = unit?.name || application.unitNameSnapshot || '';
  const unitLabel = unitName ? ` - ${unitName}` : '';
  const finalCancelUrl =
    cancelUrl ||
    buildPublicCancelUrl({
      inviteToken,
      unitId: unitId || unit?._id || application.unit || null,
    });

  const metadata = {
    applicationId: application._id.toString(),
    userId: application.user.toString(),
    scope: application.applicationScope || 'portfolio',
  };

  if (application.property) {
    metadata.propertyId = application.property.toString();
  }

  if (application.unit) {
    metadata.unitId = application.unit.toString();
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      success_url: `${frontendBase}/apply/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: finalCancelUrl,
      customer_email: application.applicantInfo?.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: applicationFeeCents,
            product_data: {
              name: `Rental application fee${unitLabel}`,
              description: propertyAddress,
            },
          },
        },
      ],
      metadata,
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
    application.status = 'Under Review';
  }

  application.stripePaymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || application.stripePaymentIntentId;

  await application.save();
  return application;
};

const buildPublicApplicationResponse = (context) => {
  const propertyAddress = context.property?.address || '';
  const unitName = context.unit?.name || '';
  const copy = buildApplicationContextSummary({
    scope: context.scope,
    propertyAddress,
    unitName,
  });

  return {
    inviteToken: context.inviteToken,
    ownerName: getOwnerDisplayName(context.owner),
    applicationScope: context.scope,
    propertyAddress,
    unitName,
    title: copy.title,
    summary: copy.summary,
    applicationFee: resolveApplicationFeeCents(context.owner) / 100,
    applicationFeeCents: resolveApplicationFeeCents(context.owner),
  };
};

const buildInvitationEmail = ({ recipientName, owner, scope, propertyAddress, unitName, url, note }) => {
  const greeting = recipientName ? `Hello ${recipientName},` : 'Hello,';
  const summary = buildApplicationContextSummary({ scope, propertyAddress, unitName });
  const locationLine =
    scope === 'unit'
      ? `${propertyAddress}${unitName ? `, ${unitName}` : ''}`
      : propertyAddress || 'our rental portfolio';

  return `
    <h1>${summary.title}</h1>
    <p>${greeting}</p>
    <p>${getOwnerDisplayName(owner)} has invited you to complete a rental application for ${locationLine}.</p>
    <p>${summary.summary}</p>
    ${
      note
        ? `<p><strong>Message from the property manager:</strong><br />${String(note)
            .trim()
            .replace(/\n/g, '<br />')}</p>`
        : ''
    }
    <p>
      <a href="${url}" style="background-color: #14B8A6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 999px; display: inline-block;">
        Start application
      </a>
    </p>
    <p>If the button does not work, copy and paste this link into your browser:</p>
    <p><a href="${url}">${url}</a></p>
  `;
};

exports.createApplicationInvite = async (req, res) => {
  try {
    const scope = VALID_INVITE_SCOPES.has(req.body?.scope) ? req.body.scope : 'portfolio';
    const recipientEmail = req.body?.recipientEmail ? String(req.body.recipientEmail).trim() : '';
    const recipientName = req.body?.recipientName ? String(req.body.recipientName).trim() : '';
    const note = req.body?.note ? String(req.body.note).trim() : '';

    let property = null;
    let unit = null;

    if (scope === 'property') {
      property = await ManagedProperty.findById(req.body?.propertyId).select('address user');
      if (!property || property.user.toString() !== req.user.id) {
        return res.status(404).json({ msg: 'Property not found.' });
      }
    }

    if (scope === 'unit') {
      unit = await Unit.findById(req.body?.unitId).populate('property', 'address user');
      if (!unit || !unit.property || unit.property.user.toString() !== req.user.id) {
        return res.status(404).json({ msg: 'Unit not found.' });
      }

      property = unit.property;
    }

    const inviteToken = buildInviteToken({
      ownerId: req.user.id,
      scope,
      propertyId: property?._id || null,
      unitId: unit?._id || null,
    });

    const url = buildPublicApplicationUrl({ inviteToken });

    if (recipientEmail) {
      await sendEmail({
        to: recipientEmail,
        subject:
          scope === 'unit'
            ? `Rental application for ${property?.address || 'your invited unit'}`
            : scope === 'property'
              ? `Rental application for ${property?.address || 'your invited property'}`
              : 'Rental application invitation',
        html: buildInvitationEmail({
          recipientName,
          owner: req.user,
          scope,
          propertyAddress: property?.address || '',
          unitName: unit?.name || '',
          url,
          note,
        }),
      });
    }

    res.status(201).json({
      url,
      emailed: Boolean(recipientEmail),
      scope,
      propertyAddress: property?.address || '',
      unitName: unit?.name || '',
      message: recipientEmail ? 'Application invite sent successfully.' : 'Application link created successfully.',
    });
  } catch (error) {
    console.error('Error creating application invite:', error);
    res.status(500).json({ msg: 'Failed to create the application invite.' });
  }
};

// @desc    Get public details for an application form
exports.getPublicApplicationDetails = async (req, res) => {
  try {
    const context = await resolvePublicApplicationContext({
      inviteToken: req.query?.invite || null,
      unitId: req.params.unitId || req.query?.unitId || null,
    });

    res.json(buildPublicApplicationResponse(context));
  } catch (error) {
    res.status(error.status || 500).json({ msg: error.message || 'Server Error' });
  }
};

// @desc    Submit a new rental application
exports.submitApplication = async (req, res) => {
  try {
    const {
      inviteToken,
      unitId,
      applicantInfo,
      residenceHistory,
      employmentHistory,
      applicantConsent,
    } = req.body;
    if (!applicantInfo?.fullName || !applicantInfo?.email || !applicantInfo?.phone) {
      return res.status(400).json({ msg: 'Please complete the required application fields.' });
    }
    if (!applicantConsent?.acceptedAt) {
      return res.status(400).json({ msg: 'You must accept the application terms before submitting.' });
    }

    const context = await resolvePublicApplicationContext({
      inviteToken: inviteToken || null,
      unitId: unitId || null,
    });

    const newApplication = new Application({
      user: context.owner._id,
      property: context.property?._id || null,
      unit: context.unit?._id || null,
      applicationScope: context.scope,
      propertyAddressSnapshot: context.property?.address || '',
      unitNameSnapshot: context.unit?.name || '',
      applicantInfo,
      residenceHistory,
      employmentHistory,
      applicantConsent: {
        acceptedAt: applicantConsent.acceptedAt,
        legalVersion: applicantConsent.legalVersion || '',
      },
    });

    await newApplication.save();

    const owner = await User.findById(context.owner._id).select(
      'name email stripeAccountId stripeOnboardingComplete applicationFeeCents'
    );
    let payment = {
      checkoutUrl: null,
      paymentStatus: 'manual_followup',
      message:
        'Your application was received, but we could not start secure payment automatically.',
    };

    try {
      payment = await createCheckoutSessionForApplication(newApplication, owner, {
        property: context.property,
        unit: context.unit,
        inviteToken: context.inviteToken,
        unitId: unitId || context.unit?._id || null,
      });
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
    console.error('Error submitting application:', error);
    res.status(error.status || 500).json({ msg: error.message || 'Server Error' });
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

    const property = application.property
      ? await ManagedProperty.findById(application.property).select('address user')
      : null;
    const unit = application.unit
      ? await Unit.findById(application.unit).populate('property', 'address user')
      : null;

    const owner = await User.findById(application.user).select(
      'name email stripeAccountId stripeOnboardingComplete applicationFeeCents'
    );
    const payment = await createCheckoutSessionForApplication(application, owner, {
      property: property || unit?.property || null,
      unit,
      cancelUrl: `${getFrontendBase()}/apply/success?payment=cancelled`,
    });

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

// @desc    Get applications for the authenticated manager
exports.getApplications = async (req, res) => {
  try {
    const filters = { user: req.user.id };

    if (req.query?.propertyId) {
      const property = await ManagedProperty.findById(req.query.propertyId).select('user');
      if (!property || property.user.toString() !== req.user.id) {
        return res.status(401).json({ msg: 'User not authorized' });
      }

      filters.property = req.query.propertyId;
    }

    const applications = await Application.find(filters)
      .populate('unit', 'name')
      .populate('property', 'address')
      .sort({ createdAt: -1 });

    res.json(applications.map(serializeApplication));
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Get all applications for a specific property
exports.getApplicationsForProperty = async (req, res) => {
  req.query.propertyId = req.params.propertyId;
  return exports.getApplications(req, res);
};

// @desc    Get a single application's full details
exports.getApplicationById = async (req, res) => {
  try {
    const application = normalizeApplicationForWrite(
      await Application.findById(req.params.id)
      .populate('unit', 'name')
      .populate('property', 'address')
    );
    if (!application || application.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Application not found or user not authorized.' });
    }
    res.json(serializeApplication(application));
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
    res.json(serializeApplication(application));
  } catch (error) {
    res.status(500).json({ msg: 'Server Error' });
  }
};

exports.buildApplicationRecordSummary = buildApplicationRecordSummary;
exports.markApplicationPaidFromSession = markApplicationPaidFromSession;

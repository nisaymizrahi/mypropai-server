const User = require('../models/User');
const { getStripeClient } = require('../lib/stripe');
const { markApplicationPaidFromSession } = require('./applicationController');

// @desc    Creates a new Stripe Express account for a user and returns an onboarding link
exports.createConnectAccount = async (req, res) => {
    try {
        const stripe = getStripeClient();
        if (!stripe) {
            return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found.' });
        }

        // If user does not have a Stripe Account ID, create one
        if (!user.stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'express',
                email: user.email,
            });
            user.stripeAccountId = account.id;
            await user.save();
        }

        // Create a one-time account link for onboarding
        const accountLink = await stripe.accountLinks.create({
            account: user.stripeAccountId,
            refresh_url: `${process.env.FRONTEND_URL}/account?stripe_reauth=true`,
            return_url: `${process.env.FRONTEND_URL}/account?stripe_success=true`,
            type: 'account_onboarding',
        });

        res.json({ url: accountLink.url });

    } catch (error) {
        console.error('Stripe Connect account creation failed:', error);
        res.status(500).json({ msg: 'Server error during Stripe account creation.' });
    }
};


// @desc    Handles the successful redirect from Stripe after user onboarding
exports.handleStripeRedirect = async (req, res) => {
    try {
        const stripe = getStripeClient();
        if (!stripe) {
            return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
        }

        const user = await User.findById(req.user.id);
        if (!user || !user.stripeAccountId) {
            return res.status(401).json({ msg: 'User or Stripe account not found.' });
        }

        // Retrieve the account details from Stripe to verify onboarding is complete
        const account = await stripe.accounts.retrieve(user.stripeAccountId);
        
        user.stripeOnboardingComplete = Boolean(account.charges_enabled && account.payouts_enabled);
        await user.save();
        
        // Redirect the user back to their account page in the frontend
        res.redirect(`${process.env.FRONTEND_URL}/account`);

    } catch (error) {
        console.error('Stripe redirect handling failed:', error);
        res.status(500).json({ msg: 'Server error during Stripe redirect handling.' });
    }
};

// @desc    Handle Stripe webhooks for checkout completion
exports.handleWebhook = async (req, res) => {
    const stripe = getStripeClient();
    if (!stripe) {
        return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(503).json({ msg: 'Stripe webhook secret is not configured.' });
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) {
        return res.status(400).json({ msg: 'Missing Stripe signature header.' });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error('Stripe webhook signature verification failed:', error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (session.payment_status === 'paid') {
                await markApplicationPaidFromSession(session);
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error('Stripe webhook handling failed:', error);
        return res.status(500).json({ msg: 'Webhook processing failed.' });
    }
};

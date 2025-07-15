const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// @desc    Creates a new Stripe Express account for a user and returns an onboarding link
exports.createConnectAccount = async (req, res) => {
    try {
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
        const user = await User.findById(req.user.id);
        if (!user || !user.stripeAccountId) {
            return res.status(401).json({ msg: 'User or Stripe account not found.' });
        }

        // Retrieve the account details from Stripe to verify onboarding is complete
        const account = await stripe.accounts.retrieve(user.stripeAccountId);
        
        if (account.details_submitted) {
            user.stripeOnboardingComplete = true;
            await user.save();
        }
        
        // Redirect the user back to their account page in the frontend
        res.redirect(`${process.env.FRONTEND_URL}/account`);

    } catch (error) {
        console.error('Stripe redirect handling failed:', error);
        res.status(500).json({ msg: 'Server error during Stripe redirect handling.' });
    }
};
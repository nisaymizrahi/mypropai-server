const Stripe = require('stripe');

let stripeClient = null;
const APPLICATION_FEE_CENTS = 5000;

const getStripeClient = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
};

module.exports = {
  APPLICATION_FEE_CENTS,
  getStripeClient,
};

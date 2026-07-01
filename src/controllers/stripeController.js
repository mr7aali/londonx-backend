const { getStripeClient, getStripeWebhookSecret } = require("../utils/stripe");
const {
  applyStripePaymentIntentToBooking,
  findBookingByPaymentIntent,
} = require("../utils/stripeBooking");

async function handleStripeWebhook(req, res, next) {
  try {
    const stripe = getStripeClient();
    const webhookSecret = getStripeWebhookSecret();
    const signature = req.headers["stripe-signature"];

    if (!webhookSecret) {
      return res.status(500).json({
        success: false,
        message: "STRIPE_WEBHOOK_SECRET is not configured",
      });
    }

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Stripe signature header is missing",
      });
    }

    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.processing" ||
      event.type === "payment_intent.canceled"
    ) {
      const paymentIntent = event.data.object;
      const booking = await findBookingByPaymentIntent(paymentIntent);

      if (booking) {
        await applyStripePaymentIntentToBooking(booking, paymentIntent);
      }
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  handleStripeWebhook,
};

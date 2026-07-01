const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const { getStripeClient } = require("./stripe");

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMetadataValue(value, maxLength = 500) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return "";
  }

  return normalizedValue.slice(0, maxLength);
}

function extractReferenceId(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (value._id) {
      return String(value._id);
    }

    if (value.id) {
      return String(value.id);
    }
  }

  return String(value);
}

function buildStripeMetadata(booking) {
  return {
    bookingId: normalizeMetadataValue(String(booking._id || "")),
    bookingNumber: normalizeMetadataValue(booking.bookingNumber || ""),
    userId: normalizeMetadataValue(extractReferenceId(booking.user)),
    courseId: normalizeMetadataValue(extractReferenceId(booking.course)),
    courseSlug: normalizeMetadataValue(booking.courseSnapshot?.slug || ""),
  };
}

function toStripeAmount(amount, currency) {
  const normalizedCurrency = normalizeString(currency).toUpperCase() || "GBP";
  const numericAmount = Number(amount || 0);

  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new Error("Booking amount must be a non-negative number");
  }

  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return Math.round(numericAmount);
  }

  return Math.round(numericAmount * 100);
}

function normalizeCardBrand(value) {
  const normalizedValue = normalizeString(value).toLowerCase();

  if (!normalizedValue) {
    return "";
  }

  return normalizedValue
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function extractCardDetails(paymentIntent) {
  const latestCharge =
    paymentIntent &&
    paymentIntent.latest_charge &&
    typeof paymentIntent.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null;

  const paymentMethod =
    paymentIntent &&
    paymentIntent.payment_method &&
    typeof paymentIntent.payment_method === "object"
      ? paymentIntent.payment_method
      : null;

  const chargeCard = latestCharge?.payment_method_details?.card || null;
  const paymentMethodCard = paymentMethod?.card || null;

  return {
    cardBrand: normalizeCardBrand(chargeCard?.brand || paymentMethodCard?.brand),
    cardLast4: normalizeString(chargeCard?.last4 || paymentMethodCard?.last4),
    paymentMethodId: normalizeString(paymentMethod?.id),
  };
}

function getPaymentIntentFailureReason(paymentIntent) {
  return (
    normalizeString(paymentIntent?.last_payment_error?.message) ||
    normalizeString(paymentIntent?.cancellation_reason) ||
    "Payment failed"
  );
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  const stripe = getStripeClient();

  return stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge", "payment_method"],
  });
}

async function confirmStripePaymentIntent(paymentIntentId, paymentMethodId) {
  const stripe = getStripeClient();

  return stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: normalizeString(paymentMethodId),
    expand: ["latest_charge", "payment_method"],
  });
}

async function findBookingByPaymentIntent(paymentIntent) {
  const bookingIdFromMetadata = normalizeString(paymentIntent?.metadata?.bookingId);

  if (bookingIdFromMetadata && mongoose.isValidObjectId(bookingIdFromMetadata)) {
    const booking = await Booking.findById(bookingIdFromMetadata);

    if (booking) {
      return booking;
    }
  }

  return Booking.findOne({
    "payment.stripePaymentIntentId": paymentIntent.id,
  });
}

async function applyStripePaymentIntentToBooking(booking, paymentIntent) {
  const cardDetails = extractCardDetails(paymentIntent);
  const paymentIntentStatus = normalizeString(paymentIntent?.status);

  booking.payment.method = "stripe";
  booking.payment.stripePaymentIntentId = normalizeString(paymentIntent?.id);
  booking.payment.stripePaymentIntentStatus = paymentIntentStatus;
  booking.payment.stripePaymentMethodId = cardDetails.paymentMethodId;
  booking.payment.cardBrand = cardDetails.cardBrand;
  booking.payment.cardLast4 = cardDetails.cardLast4;

  if (paymentIntentStatus === "succeeded") {
    booking.status = "confirmed";
    booking.confirmedAt = booking.confirmedAt || new Date();
    booking.cancelledAt = null;
    booking.payment.status = "paid";
    booking.payment.failureReason = "";
    booking.payment.transactionId =
      normalizeString(paymentIntent?.latest_charge?.id) || normalizeString(paymentIntent?.id);
    booking.payment.paidAt = booking.payment.paidAt || new Date((paymentIntent.created || Date.now() / 1000) * 1000);
  } else if (paymentIntentStatus === "processing" || paymentIntentStatus === "requires_capture") {
    booking.status = "pending_payment";
    booking.confirmedAt = null;
    booking.payment.status = "pending";
    booking.payment.failureReason = "";
  } else if (
    paymentIntentStatus === "requires_payment_method" ||
    paymentIntentStatus === "canceled"
  ) {
    booking.status = "pending_payment";
    booking.confirmedAt = null;
    booking.payment.status = "failed";
    booking.payment.failureReason = getPaymentIntentFailureReason(paymentIntent);
    booking.payment.paidAt = null;
  } else {
    booking.status = "pending_payment";
    booking.confirmedAt = null;
    booking.payment.status = "pending";
  }

  await booking.save();

  return booking;
}

async function createOrReuseStripePaymentIntentForBooking(booking) {
  const existingIntentId = normalizeString(booking.payment?.stripePaymentIntentId);

  if (existingIntentId) {
    const existingIntent = await retrieveStripePaymentIntent(existingIntentId);

    if (existingIntent.status !== "canceled") {
      booking.payment.stripePaymentIntentStatus = normalizeString(existingIntent.status);
      await booking.save();
      return existingIntent;
    }
  }

  const stripe = getStripeClient();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: toStripeAmount(booking.payment?.amount || 0, booking.payment?.currency || "GBP"),
    currency: normalizeString(booking.payment?.currency).toLowerCase() || "gbp",
    payment_method_types: ["card"],
    description: `${booking.courseSnapshot?.title || "Course booking"} (${booking.bookingNumber})`,
    receipt_email: normalizeString(booking.personalDetails?.email) || undefined,
    metadata: buildStripeMetadata(booking),
  });

  booking.payment.stripePaymentIntentId = paymentIntent.id;
  booking.payment.stripePaymentIntentStatus = normalizeString(paymentIntent.status);
  booking.payment.method = "stripe";
  await booking.save();

  return paymentIntent;
}

async function syncBookingPaymentWithStripeByIntentId(paymentIntentId) {
  const paymentIntent = await retrieveStripePaymentIntent(paymentIntentId);
  const booking = await findBookingByPaymentIntent(paymentIntent);

  if (!booking) {
    return {
      paymentIntent,
      booking: null,
    };
  }

  return {
    paymentIntent,
    booking: await applyStripePaymentIntentToBooking(booking, paymentIntent),
  };
}

module.exports = {
  createOrReuseStripePaymentIntentForBooking,
  applyStripePaymentIntentToBooking,
  confirmStripePaymentIntent,
  retrieveStripePaymentIntent,
  findBookingByPaymentIntent,
  syncBookingPaymentWithStripeByIntentId,
};

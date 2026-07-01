const User = require("../models/User");
const Notification = require("../models/Notification");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildBookingSubmittedNotificationPayload({ booking, actor, recipientId }) {
  const candidateName =
    normalizeString(booking.personalDetails?.fullName) ||
    normalizeString(actor?.name) ||
    "A candidate";
  const courseTitle = normalizeString(booking.courseSnapshot?.title) || "course";

  return {
    recipient: recipientId,
    actor: actor?._id || actor?.id || null,
    type: "booking_submitted",
    booking: booking._id,
    title: "New booking submitted",
    message: `${candidateName} submitted ${courseTitle} for admin review.`,
    metadata: {
      bookingId: String(booking._id),
      applicationStatus: booking.applicationStatus || "submitted",
      courseTitle,
      candidateName,
    },
  };
}

function buildBookingApprovedNotificationPayload({ booking, actor, recipientId }) {
  const courseTitle = normalizeString(booking.courseSnapshot?.title) || "your booking";
  const isPaid = booking.payment?.status === "paid";
  const actorName = normalizeString(actor?.name) || "Admin";

  return {
    recipient: recipientId,
    actor: actor?._id || actor?.id || null,
    type: isPaid ? "booking_approved" : "paperwork_approved",
    booking: booking._id,
    title: isPaid ? "Booking approved" : "Paperwork approved",
    message: isPaid
      ? `${actorName} approved your ${courseTitle} booking and payment has been recorded.`
      : `${actorName} approved your paperwork for ${courseTitle}. You can proceed to payment now.`,
    metadata: {
      bookingId: String(booking._id),
      applicationStatus: booking.applicationStatus || "approved",
      courseTitle,
      paymentStatus: booking.payment?.status || "pending",
      paymentRequired: !isPaid,
      actorName,
      approvalType: isPaid ? "booking" : "paperwork",
    },
  };
}

async function createNotifications(notifications) {
  const validNotifications = Array.isArray(notifications) ? notifications.filter(Boolean) : [];

  if (validNotifications.length === 0) {
    return [];
  }

  return Notification.insertMany(validNotifications);
}

async function notifyAdminsOfBookingSubmission(booking, actor) {
  const admins = await User.find({ role: "admin" }).select("_id");

  if (!admins.length) {
    return [];
  }

  return createNotifications(
    admins.map((admin) =>
      buildBookingSubmittedNotificationPayload({
        booking,
        actor,
        recipientId: admin._id,
      })
    )
  );
}

async function notifyUserOfBookingApproval(booking, actor) {
  const userId = booking.user?._id || booking.user;

  if (!userId) {
    return [];
  }

  const payload = buildBookingApprovedNotificationPayload({
    booking,
    actor,
    recipientId: userId,
  });

  const notification = await Notification.findOneAndUpdate(
    {
      recipient: payload.recipient,
      booking: payload.booking,
      type: payload.type,
    },
    {
      $set: {
        actor: payload.actor,
        title: payload.title,
        message: payload.message,
        metadata: payload.metadata,
        isRead: false,
        readAt: null,
      },
      $setOnInsert: {
        recipient: payload.recipient,
        booking: payload.booking,
        type: payload.type,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return notification ? [notification] : [];
}

module.exports = {
  notifyAdminsOfBookingSubmission,
  notifyUserOfBookingApproval,
};

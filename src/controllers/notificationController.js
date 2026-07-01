const mongoose = require("mongoose");

const Notification = require("../models/Notification");

const UK_TIME_ZONE = "Europe/London";

function formatDisplayDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getNotificationTypeLabel(type) {
  return {
    booking_submitted: "Booking Submitted",
    booking_approved: "Booking Approved",
    paperwork_approved: "Paperwork Approved",
  }[type] || "Notification";
}

function mapNotification(notification) {
  return {
    id: String(notification._id),
    type: notification.type,
    typeLabel: getNotificationTypeLabel(notification.type),
    title: notification.title,
    message: notification.message,
    isRead: Boolean(notification.isRead),
    readAt: notification.readAt || null,
    readAtLabel: formatDisplayDateTime(notification.readAt),
    createdAt: notification.createdAt,
    createdAtLabel: formatDisplayDateTime(notification.createdAt),
    bookingId: notification.booking ? String(notification.booking._id || notification.booking) : "",
    metadata: notification.metadata || {},
    actions: {
      markAsRead: {
        label: "Mark as Read",
        method: "PATCH",
        apiUrl: `/api/notifications/${notification._id}/read`,
        enabled: !notification.isRead,
      },
      viewBooking: notification.booking
        ? {
            label: "View Booking",
            apiUrl: `/api/bookings/${notification.booking._id || notification.booking}`,
          }
        : null,
    },
  };
}

function buildNotificationScreen(notifications) {
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  return {
    title: "Notifications",
    subtitle: "Track booking submissions and approval updates.",
    summary: {
      total: notifications.length,
      unread: unreadCount,
    },
    actions: {
      markAllAsRead: {
        label: "Mark All as Read",
        method: "PATCH",
        apiUrl: "/api/notifications/read-all",
        enabled: unreadCount > 0,
      },
    },
    items: notifications.map(mapNotification),
  };
}

async function getMyNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .populate("booking", "_id bookingNumber courseSnapshot applicationStatus");

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: {
        screen: buildNotificationScreen(notifications),
        notifications: notifications.map(mapNotification),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyNotificationById(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user.id,
    }).populate("booking", "_id bookingNumber courseSnapshot applicationStatus");

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification fetched successfully",
      data: {
        notification: mapNotification(notification),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function markMyNotificationAsRead(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user.id,
    }).populate("booking", "_id bookingNumber courseSnapshot applicationStatus");

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    notification.isRead = true;
    notification.readAt = notification.readAt || new Date();
    await notification.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read successfully",
      data: {
        notification: mapNotification(notification),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function markAllMyNotificationsAsRead(req, res, next) {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    const notifications = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .populate("booking", "_id bookingNumber courseSnapshot applicationStatus");

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read successfully",
      data: {
        screen: buildNotificationScreen(notifications),
        notifications: notifications.map(mapNotification),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyNotifications,
  getMyNotificationById,
  markMyNotificationAsRead,
  markAllMyNotificationsAsRead,
};

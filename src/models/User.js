const mongoose = require("mongoose");

const userNotificationSettingsSchema = new mongoose.Schema(
  {
    courseUpdates: {
      type: Boolean,
      default: true,
    },
    bookingConfirmations: {
      type: Boolean,
      default: true,
    },
    checklistReminders: {
      type: Boolean,
      default: true,
    },
    documentRequests: {
      type: Boolean,
      default: true,
    },
    signatureRequests: {
      type: Boolean,
      default: true,
    },
    weeklyProgressDigest: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    ntiNumber: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "",
    },
    profileImageUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    passwordSalt: {
      type: String,
      required: true,
      select: false,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    notificationSettings: {
      type: userNotificationSettingsSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("User", userSchema);

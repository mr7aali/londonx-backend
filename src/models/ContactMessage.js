const mongoose = require("mongoose");

const contactMessageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      maxlength: 160,
    },
    phoneNumber: {
      type: String,
      trim: true,
      required: true,
      maxlength: 30,
    },
    message: {
      type: String,
      trim: true,
      required: true,
      minlength: 5,
      maxlength: 5000,
    },
    howDidYouFindUs: {
      type: String,
      trim: true,
      default: "",
      maxlength: 80,
    },
    status: {
      type: String,
      enum: ["new", "read", "resolved"],
      default: "new",
      required: true,
      index: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("ContactMessage", contactMessageSchema);

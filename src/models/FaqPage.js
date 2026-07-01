const mongoose = require("mongoose");

const faqItemSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: true,
  }
);

const faqPageSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: ["faq"],
      default: "faq",
      unique: true,
      index: true,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "SUPPORT",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
      default: "FAQ",
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "Add, remove, and update frequently asked questions for the public-facing FAQ section.",
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    items: {
      type: [faqItemSchema],
      default: [],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("FaqPage", faqPageSchema);

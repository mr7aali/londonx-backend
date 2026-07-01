const mongoose = require("mongoose");

const legalPageSectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    introduction: {
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

const legalPageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      enum: ["terms-and-conditions", "privacy-policy"],
      required: true,
      unique: true,
      index: true,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    sections: {
      type: [legalPageSectionSchema],
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

module.exports = mongoose.model("LegalPage", legalPageSchema);

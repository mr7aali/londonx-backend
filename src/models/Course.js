const mongoose = require("mongoose");

const courseSectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
  },
  {
    _id: false,
  }
);

const assessmentVariantPricingSchema = new mongoose.Schema(
  {
    am2: {
      type: Number,
      min: 0,
      default: 885,
    },
    am2e: {
      type: Number,
      min: 0,
      default: 965,
    },
    am2eV1: {
      type: Number,
      min: 0,
      default: 1235,
    },
  },
  {
    _id: false,
  }
);

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 160,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["available", "upcoming", "archived"],
      default: "available",
      required: true,
    },
    schedule: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 500,
    },
    overview: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },
    qualification: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
    assessmentVariant: {
      type: String,
      enum: ["am2", "am2e", "am2e-v1"],
      default: "am2",
      required: true,
    },
    sourceCourse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    sourceCourseName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
    sessionDate: {
      type: Date,
      default: null,
    },
    timeSlot: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    entryRequirements: {
      type: String,
      trim: true,
      maxlength: 250,
      default: "",
    },
    audience: {
      type: String,
      trim: true,
      maxlength: 250,
      default: "",
    },
    duration: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    assessmentVariantPricing: {
      type: assessmentVariantPricingSchema,
      default: undefined,
    },
    totalSeats: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: "GBP",
    },
    vatEnabled: {
      type: Boolean,
      default: false,
    },
    vatIncluded: {
      type: Boolean,
      default: false,
    },
    priceNote: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    galleryImages: {
      type: [String],
      default: [],
    },
    bookNowUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    tags: {
      type: [String],
      default: [],
    },
    detailSections: {
      type: [courseSectionSchema],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

courseSchema.pre("validate", async function ensureAssessmentVariant() {
  if (!this.assessmentVariant) {
    this.assessmentVariant = "am2";
  }
});

module.exports = mongoose.model("Course", courseSchema);

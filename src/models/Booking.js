const mongoose = require("mongoose");

const bookingCourseSnapshotSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    schedule: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    duration: {
      type: String,
      trim: true,
      maxlength: 120,
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
    },
    location: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vatEnabled: {
      type: Boolean,
      default: false,
    },
    vatRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    vatAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalPrice: {
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
  },
  {
    _id: false,
  }
);

const bookingPersonalDetailsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
    niNumber: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    addressLine1: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    addressLine2: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },
    trainingCenter: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    town: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    postcode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
  },
  {
    _id: false,
  }
);

const bookingEligibilityCheckSchema = new mongoose.Schema(
  {
    qualificationId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    qualificationLabel: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    nvqRegistrationDate: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingAssessmentDetailsSchema = new mongoose.Schema(
  {
    apprentice: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    uln: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "",
    },
    funding: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    awardingBody: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    reasonableAdjustments: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    recognitionOfPriorLearning: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    assessmentType: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingOrganizationDetailsSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
      default: "",
    },
    contactName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    contactNumber: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    address1: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    address2: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    address3: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    address4: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    town: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    postcode: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingPaymentSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      required: true,
      default: "pending",
    },
    amount: {
      type: Number,
      min: 0,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: "GBP",
    },
    agreedToTerms: {
      type: Boolean,
      default: false,
    },
    method: {
      type: String,
      enum: ["card", "manual", "stripe"],
      default: "stripe",
    },
    transactionId: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    cardBrand: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    cardLast4: {
      type: String,
      trim: true,
      maxlength: 4,
      default: "",
    },
    paidAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    stripePaymentIntentStatus: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    stripePaymentMethodId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingSessionSchema = new mongoose.Schema(
  {
    startDateTime: {
      type: Date,
      default: null,
    },
    endDateTime: {
      type: Date,
      default: null,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingDocumentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      trim: true,
      maxlength: 80,
      required: true,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 160,
      required: true,
    },
    fileName: {
      type: String,
      trim: true,
      maxlength: 255,
      required: true,
    },
    fileUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
    },
    mimeType: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const bookingChecklistResponseSchema = new mongoose.Schema(
  {
    itemId: {
      type: String,
      trim: true,
      maxlength: 160,
      required: true,
    },
    knowledgeLevel: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    experienceLevel: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const bookingSignatureSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["not_signed", "requested", "signed"],
      default: "not_signed",
    },
    signerName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    signerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
      default: "",
    },
    signatureType: {
      type: String,
      enum: ["draw", "upload", "typed", ""],
      default: "",
    },
    signatureData: {
      type: String,
      trim: true,
      maxlength: 500000,
      default: "",
    },
    fileName: {
      type: String,
      trim: true,
      maxlength: 255,
      default: "",
    },
    requestedAt: {
      type: Date,
      default: null,
    },
    signedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const bookingTrainingProviderRequestSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
      default: "",
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    token: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    courseSnapshot: {
      type: bookingCourseSnapshotSchema,
      required: true,
    },
    personalDetails: {
      type: bookingPersonalDetailsSchema,
      required: true,
    },
    eligibilityCheck: {
      type: bookingEligibilityCheckSchema,
      default: () => ({}),
    },
    assessmentDetails: {
      type: bookingAssessmentDetailsSchema,
      default: () => ({}),
    },
    employerDetails: {
      type: bookingOrganizationDetailsSchema,
      default: () => ({}),
    },
    trainingProviderDetails: {
      type: bookingOrganizationDetailsSchema,
      default: () => ({}),
    },
    privacyConfirmation: {
      type: Boolean,
      default: false,
    },
    privacyConfirmedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending_payment", "confirmed", "cancelled"],
      required: true,
      default: "pending_payment",
      index: true,
    },
    payment: {
      type: bookingPaymentSchema,
      required: true,
    },
    session: {
      type: bookingSessionSchema,
      default: () => ({}),
    },
    documents: {
      type: [bookingDocumentSchema],
      default: [],
    },
    checklistResponses: {
      type: [bookingChecklistResponseSchema],
      default: [],
    },
    candidateSignature: {
      type: bookingSignatureSchema,
      default: () => ({}),
    },
    trainingProviderSignature: {
      type: bookingSignatureSchema,
      default: () => ({}),
    },
    trainingProviderSignatureRequest: {
      type: bookingTrainingProviderRequestSchema,
      default: () => ({}),
    },
    applicationStatus: {
      type: String,
      enum: ["draft", "submitted", "under_review", "approved", "rejected"],
      default: "draft",
      index: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("Booking", bookingSchema);

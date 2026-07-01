const crypto = require("node:crypto");
const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Course = require("../models/Course");
const {
  buildAssessmentVariantPricing,
  buildCandidateRegistrationForm,
  buildAssessmentRegistrationForm,
  buildCoursePricing,
  buildEmployerRegistrationForm,
  buildTrainingRegistrationForm,
  buildPrivacyRegistrationForm,
  isAssessmentVariantPricingCourse,
  normalizeAssessmentVariant,
  resolveAssessmentVariantPriceForCourse,
} = require("./courseController");
const { getStripePublishableKey, isStripeConfigured } = require("../utils/stripe");
const {
  createOrReuseStripePaymentIntentForBooking,
  confirmStripePaymentIntent,
  syncBookingPaymentWithStripeByIntentId,
} = require("../utils/stripeBooking");
const {
  sendBookingApprovalEmail,
  sendTrainingProviderSignatureRequestEmail,
} = require("../utils/mailer");
const {
  notifyAdminsOfBookingSubmission,
  notifyUserOfBookingApproval,
} = require("../utils/notifications");

const BOOKING_STATUSES = ["pending_payment", "confirmed", "cancelled"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
const BOOKING_TABS = ["upcoming", "past", "cancelled"];
const APPLICATION_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected"];
const CHECKLIST_VARIANTS = ["am2", "am2e", "am2e-v1"];
const SIGNATURE_DATA_MAX_LENGTH = 500000;
const VAT_RATE = 0.2;
const UK_TIME_ZONE = "Europe/London";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value, fallbackValue = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return fallbackValue;
}

function normalizeNumber(value, fallbackValue = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return fallbackValue;
}

function normalizeChecklistVariant(value) {
  const normalizedValue = normalizeAssessmentVariant(value);
  return CHECKLIST_VARIANTS.includes(normalizedValue) ? normalizedValue : "";
}

function buildUrlFromBase(baseUrl, token) {
  const normalizedBaseUrl = normalizeString(baseUrl);

  if (!normalizedBaseUrl) {
    return "";
  }

  if (normalizedBaseUrl.includes("{token}")) {
    return normalizedBaseUrl.replace("{token}", encodeURIComponent(token));
  }

  return `${normalizedBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}`;
}

function buildTrainingProviderFrontendUrl(frontendBaseUrl, token) {
  const normalizedBaseUrl = normalizeString(frontendBaseUrl);

  if (!normalizedBaseUrl) {
    return "";
  }

  if (normalizedBaseUrl.includes("{token}")) {
    return normalizedBaseUrl.replace("{token}", encodeURIComponent(token));
  }

  return `${normalizedBaseUrl.replace(/\/+$/, "")}/provider-signature/${encodeURIComponent(token)}`;
}

function getFrontendBaseUrl() {
  return (
    normalizeString(process.env.FRONTEND_URL) ||
    normalizeString(process.env.CLIENT_URL) ||
    normalizeString(process.env.APP_URL) ||
    normalizeString(process.env.PUBLIC_APP_URL)
  ).replace(/\/+$/, "");
}

function getBookingPaymentFrontendUrl(booking) {
  const frontendBaseUrl = getFrontendBaseUrl();

  if (!frontendBaseUrl || !booking?._id) {
    return "";
  }

  return `${frontendBaseUrl}/bookings/${encodeURIComponent(String(booking._id))}/checkout/payment`;
}

function getTrainingProviderSignatureLink(token) {
  const configuredSignatureBase = normalizeString(process.env.TRAINING_PROVIDER_SIGNATURE_URL_BASE);

  if (configuredSignatureBase) {
    return buildUrlFromBase(configuredSignatureBase, token);
  }

  const frontendBase = getFrontendBaseUrl() || "http://localhost:3000";

  if (frontendBase) {
    return buildTrainingProviderFrontendUrl(frontendBase, token);
  }

  return getTrainingProviderSignatureApiUrl(token);
}

function getTrainingProviderSignatureApiUrl(token) {
  const apiBaseUrl =
    normalizeString(process.env.PUBLIC_API_BASE_URL) ||
    normalizeString(process.env.API_BASE_URL) ||
    "http://localhost:5000";

  return `${apiBaseUrl.replace(/\/+$/, "")}/api/bookings/provider-signature/${encodeURIComponent(token)}`;
}

function getCandidateSignatureStatus(booking) {
  if (booking?.candidateSignature?.status === "signed") {
    return "signed";
  }

  return booking?.payment?.agreedToTerms ? "signed" : "not_signed";
}

function getTrainingProviderSignatureStatus(booking) {
  return booking?.trainingProviderSignature?.status || "not_signed";
}

function isAm2BookingFlow(booking) {
  const source = [
    booking?.courseSnapshot?.title,
    booking?.courseSnapshot?.slug,
    booking?.courseSnapshot?.qualification,
  ]
    .map((value) => normalizeString(value).toLowerCase())
    .join(" ");

  return /\bam2(?:e(?:[\s_-]*v?1)?)?\b/.test(source);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundMoney(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function getFractionDigitCount(amount) {
  return Number.isInteger(roundMoney(amount)) ? 0 : 2;
}

function formatDisplayPrice(amount, currency) {
  const normalizedAmount = roundMoney(amount);
  const fractionDigits = getFractionDigitCount(normalizedAmount);

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
    }).format(normalizedAmount);
  } catch (error) {
    return `${currency || "GBP"} ${normalizedAmount.toFixed(fractionDigits)}`;
  }
}

function calculateVatPricing(baseAmount, vatEnabled) {
  const amount = roundMoney(baseAmount);
  const normalizedVatEnabled = Boolean(vatEnabled);
  const vatAmount = normalizedVatEnabled ? roundMoney(amount * VAT_RATE) : 0;
  const totalAmount = roundMoney(amount + vatAmount);

  return {
    amount,
    vatEnabled: normalizedVatEnabled,
    vatRate: normalizedVatEnabled ? VAT_RATE : 0,
    vatAmount,
    totalAmount,
  };
}

function buildPricingDisplay(payload) {
  const amount = roundMoney(payload?.amount ?? payload?.price ?? 0);
  const currency = payload?.currency || "GBP";
  const vatEnabled = Boolean(payload?.vatEnabled);
  const vatAmount = vatEnabled ? roundMoney(payload?.vatAmount ?? amount * VAT_RATE) : 0;
  const totalAmount = roundMoney(payload?.totalAmount ?? payload?.totalPrice ?? amount + vatAmount);
  const baseDisplayPrice = formatDisplayPrice(amount, currency);
  const totalDisplayPrice = formatDisplayPrice(totalAmount, currency);

  return {
    amount,
    baseAmount: amount,
    currency,
    vatEnabled,
    vatIncluded: vatEnabled,
    vatRate: vatEnabled ? VAT_RATE : 0,
    vatPercentage: vatEnabled ? VAT_RATE * 100 : 0,
    vatAmount,
    totalAmount,
    displayPrice: vatEnabled
      ? `${baseDisplayPrice} + VAT (${totalDisplayPrice})`
      : baseDisplayPrice,
    baseDisplayPrice,
    totalDisplayPrice,
    note: vatEnabled ? `+ VAT (${totalDisplayPrice})` : "",
  };
}

function buildBookingCoursePricing(booking) {
  const courseSnapshot = booking.courseSnapshot || {};
  const amount = roundMoney(courseSnapshot.price ?? booking.payment?.amount ?? 0);
  const currency = booking.payment?.currency || courseSnapshot.currency || "GBP";
  const vatEnabled = Boolean(courseSnapshot.vatEnabled);
  const fallbackPricing = calculateVatPricing(amount, vatEnabled);
  const storedTotalAmount = Number(courseSnapshot.totalPrice);
  const paymentAmount = booking.payment?.amount;
  const totalAmount =
    Number.isFinite(storedTotalAmount) && (storedTotalAmount > 0 || amount === 0)
      ? storedTotalAmount
      : paymentAmount ?? fallbackPricing.totalAmount;

  return buildPricingDisplay({
    amount,
    currency,
    vatEnabled,
    vatAmount: courseSnapshot.vatAmount ?? fallbackPricing.vatAmount,
    totalAmount,
  });
}

function formatDisplayDate(value) {
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
  }).format(date);
}

function formatDisplayTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\s/g, " ")
    .toLowerCase();
}

function formatDisplayDateTime(value) {
  const displayDate = formatDisplayDate(value);
  const displayTime = formatDisplayTime(value);

  return [displayDate, displayTime].filter(Boolean).join(" ");
}

function formatDateOnly(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatDisplayDateShort(value) {
  const dateOnly = formatDateOnly(value);

  if (!dateOnly) {
    return "";
  }

  const [year, month, day] = dateOnly.split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}

function parsePagination(query) {
  const page = Math.max(1, Math.floor(normalizeNumber(query.page, 1)));
  const limit = Math.min(50, Math.max(1, Math.floor(normalizeNumber(query.limit, 10))));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomDigits(length) {
  let output = "";

  while (output.length < length) {
    output += Math.floor(Math.random() * 10);
  }

  return output.slice(0, length);
}

function randomUkPostcode() {
  const outward = pickRandom(["E1", "SW1A", "M1", "B1", "LS1", "SE10", "EC1A", "N1"]);
  const inward = `${Math.floor(Math.random() * 9) + 1}${pickRandom(["AA", "AB", "BB", "CD", "EF", "GH"])}`;
  return `${outward} ${inward}`;
}

function randomPhoneNumber() {
  return `07${randomDigits(9)}`;
}

function randomDateOfBirth() {
  const year = 1984 + Math.floor(Math.random() * 14);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildMockRegistrationData(course = null) {
  const titles = ["Mr", "Mrs", "Ms", "Miss"];
  const firstNames = ["Daniel", "James", "Aisha", "Olivia", "Mason", "Sophie", "Arif", "Emily"];
  const lastNames = ["Carter", "Rahman", "Patel", "Thompson", "Hughes", "Walker", "Ahmed", "Wilson"];
  const towns = ["London", "Ilford", "Croydon", "Luton", "Birmingham", "Leeds", "Manchester"];
  const streetNames = ["King Street", "Victoria Road", "Station Lane", "Park Avenue", "High Street"];
  const companyPrefixes = ["North", "Prime", "Apex", "Summit", "Metro", "Bright"];
  const companySuffixes = ["Electrical", "Training", "Assessment", "Compliance", "Services"];
  const awardingBodies = ["city-and-guilds", "eal", "nja", "other"];
  const fundingOptions = ["england-16-18", "england-19-plus", "other"];
  const assessmentTypes = [
    "am2",
    "am2e",
    "awcs-v1-0",
    "am2ed",
    "am20",
    "cable-jointing",
    "am2e-v1-1",
    "am2s-v1-1-2",
    "aqdsvn",
  ];

  const title = pickRandom(titles);
  const firstName = pickRandom(firstNames);
  const lastName = pickRandom(lastNames);
  const fullName = `${firstName} ${lastName}`;
  const town = pickRandom(towns);
  const companyName = `${pickRandom(companyPrefixes)} ${pickRandom(companySuffixes)} Ltd`;
  const trainingProviderName = `${pickRandom(companyPrefixes)} Skills Academy`;
  const emailSlug = `${firstName}.${lastName}`.toLowerCase();
  const trainingCenter =
    normalizeString(course?.location) || "London & Essex Electrical Training";

  return {
    course: course
      ? {
          id: String(course._id),
          title: course.title || "",
          slug: course.slug || "",
          qualification: course.qualification || "",
          location: course.location || "",
          schedule: course.schedule || "",
        }
      : null,
    personalDetails: {
      title,
      firstName,
      lastName,
      fullName,
      dateOfBirth: randomDateOfBirth(),
      niNumber: `QQ${randomDigits(6)}C`,
      email: `${emailSlug}@example.com`,
      mobileNumber: randomPhoneNumber(),
      phoneNumber: randomPhoneNumber(),
      addressLine1: `${Math.floor(Math.random() * 180) + 1} ${pickRandom(streetNames)}`,
      addressLine2: "Flat 2B",
      address: `${Math.floor(Math.random() * 180) + 1} ${pickRandom(streetNames)}, Flat 2B`,
      town,
      city: town,
      postcode: randomUkPostcode(),
      trainingCenter,
    },
    assessmentDetails: {
      apprentice: pickRandom(["yes", "no"]),
      uln: randomDigits(10),
      funding: pickRandom(fundingOptions),
      awardingBody: pickRandom(awardingBodies),
      reasonableAdjustments: pickRandom(["yes", "no"]),
      recognitionOfPriorLearning: pickRandom(["yes", "no"]),
      assessmentType: pickRandom(assessmentTypes),
    },
    employerDetails: {
      companyName,
      email: `office@${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.co.uk`,
      contactName: `Manager ${lastName}`,
      contactNumber: randomPhoneNumber(),
      address1: `${Math.floor(Math.random() * 220) + 1} Industrial Estate`,
      address2: "Unit 4",
      address3: "",
      address4: "",
      town,
      postcode: randomUkPostcode(),
      noEmployerStatus: pickRandom(["na", "self-employed", "employed"]),
    },
    trainingProviderDetails: {
      companyName: trainingProviderName,
      email: `admin@${trainingProviderName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.co.uk`,
      contactName: `Tutor ${lastName}`,
      contactNumber: randomPhoneNumber(),
      address1: `${Math.floor(Math.random() * 140) + 1} College Road`,
      address2: "Training Centre",
      address3: "",
      address4: "",
      town: pickRandom(towns),
      postcode: randomUkPostcode(),
    },
    privacyConfirmation: true,
  };
}

function buildPdfCoverageReport() {
  return {
    coveredFields: [
      "title",
      "firstName",
      "lastName",
      "dateOfBirth",
      "niNumber",
      "email",
      "mobileNumber",
      "addressLine1",
      "addressLine2",
      "town",
      "postcode",
      "apprentice",
      "uln",
      "funding",
      "awardingBody",
      "reasonableAdjustments",
      "recognitionOfPriorLearning",
      "assessmentType",
      "employer company/contact/address fields",
      "training provider company/contact/address fields",
      "privacyConfirmation",
    ],
    likelyMissingFields: [
      {
        field: "employer no-employer/self-employed choice",
        status: "missing_in_backend_model",
        note:
          "The PDF/screenshot shows a dedicated N/A or self-employed selection on the employer step, but the backend only stores employer organization fields.",
      },
    ],
    notes: [
      "The current backend already stores both town and city; the PDF screens only visibly require town.",
      "Address 3 and Address 4 are supported for employer and training provider.",
      "This comparison is based on the provided PDF screenshots and existing form definitions in the codebase.",
    ],
  };
}

function buildAm2ChecklistFlowCoverageReport() {
  return {
    checklistCoverage: {
      matched: [
        "Section A1 with 2 checklist items",
        "Sections A2-A5 with 19 checklist items",
        "Section B with 14 checklist items",
        "Section C with 3 checklist items",
        "Section D with 5 checklist items",
        "Section E with 4 checklist items",
        "Knowledge level options: Extensive, Adequate, Limited, Unsure",
        "Experience level options: Extensive, Adequate, Limited, Unsure",
        "Checklist progress summary and per-section completion counts",
        "Documents -> Checklist -> Signatures -> Submit -> Review -> Payment -> Confirmed step flow",
      ],
      missingFields: [],
      mismatches: [
        {
          field: "candidate signature upload file guidance",
          status: "ui_backend_mismatch",
          note:
            "The screenshot mentions a square image under 100KB, but the backend currently accepts JPG/PNG/WEBP uploads up to 5MB and does not enforce square dimensions.",
        },
        {
          field: "submit gate after checklist",
          status: "flow_rule_changed",
          note:
            "The screenshot flow implies signatures are required before submit, but the backend currently allows submission after documents and checklist are complete.",
        },
      ],
      notes: [
        "Based on the provided AM2 checklist screenshots, the checklist section counts and assessment levels are already represented in the backend.",
        "No checklist-item data fields appear to be missing for the AM2 self-assessment flow.",
      ],
    },
  };
}

function getChecklistAssessmentName(variant = "am2") {
  if (variant === "am2e") {
    return "AM2E";
  }

  if (variant === "am2e-v1") {
    return "AM2E V1";
  }

  return "AM2";
}

function buildCandidateSignatureImagePayload(signature = {}) {
  const details = mapSignatureForClient(signature);
  const dateValue = formatDateOnly(details.signedAt);
  const dateLabel = formatDisplayDateShort(details.signedAt);

  return {
    id: "candidate-signature-image",
    label: "Candidate Signature Image",
    type: "image",
    status: details.status,
    signatureType: details.signatureType,
    signatureData: details.signatureData,
    url: details.url,
    imageUrl: details.imageUrl,
    signatureImageUrl: details.imageUrl,
    previewUrl: details.previewUrl,
    downloadUrl: details.downloadUrl,
    available: details.available,
    fileName: details.fileName,
    signedAt: details.signedAt,
    date: dateValue,
    dateValue,
    dateLabel,
    acceptedFileTypes: ["jpg", "jpeg", "png", "webp"],
    uploadFields: ["file", "image", "signature", "candidateSignature", "signatureData", "signatureImageUrl"],
  };
}

function buildTrainingProviderSignaturePayload(signature = {}) {
  const details = mapSignatureForClient(signature);
  const dateValue = formatDateOnly(details.signedAt);
  const dateLabel = formatDisplayDateShort(details.signedAt);

  return {
    id: "training-provider-signature",
    label: "Training Provider Signature",
    status: details.status,
    signerName: details.signerName,
    signerEmail: details.signerEmail,
    signatureType: details.signatureType,
    signatureData: details.signatureData,
    url: details.url,
    imageUrl: details.imageUrl,
    signatureImageUrl: details.imageUrl,
    previewUrl: details.previewUrl,
    downloadUrl: details.downloadUrl,
    available: details.available,
    fileName: details.fileName,
    signedAt: details.signedAt,
    date: dateValue,
    dateValue,
    dateLabel,
    signatureImage: {
      id: "training-provider-signature-image",
      label: "Training Provider Signature Image",
      type: "image",
      signatureData: details.signatureData,
      url: details.url,
      imageUrl: details.imageUrl,
      signatureImageUrl: details.imageUrl,
      previewUrl: details.previewUrl,
      downloadUrl: details.downloadUrl,
      available: details.available,
      fileName: details.fileName,
      signedAt: details.signedAt,
      date: dateValue,
      dateValue,
      dateLabel,
    },
    fields: [
      {
        id: "trainingProviderSignature",
        label: "Training Provider Signature",
        type: "signature",
        value: details.imageUrl,
        defaultValue: details.imageUrl,
        imageUrl: details.imageUrl,
        required: true,
      },
      {
        id: "trainingProviderPrintName",
        label: "Print Name",
        type: "text",
        value: details.signerName,
        defaultValue: details.signerName,
        required: true,
      },
      {
        id: "trainingProviderDate",
        label: "Date",
        type: "date",
        value: dateValue,
        defaultValue: dateValue,
        required: true,
      },
    ],
  };
}

function getCandidatePrintNameFromQuery(query = {}) {
  return normalizeString(
    query.printName ||
      query.candidateName ||
      query.fullName ||
      query.signerName ||
      query.name
  );
}

function buildCandidateReadinessDeclaration(variant = "am2", signature = {}, options = {}) {
  const assessmentName = getChecklistAssessmentName(variant);
  const signatureImage = buildCandidateSignatureImagePayload(signature);
  const printName = normalizeString(options.printName) || normalizeString(signature.signerName);
  const signedDate = signatureImage.dateValue;
  const signedDateLabel = signatureImage.dateLabel;
  const bodyText =
    'As the candidate, I formally confirm that I believe I am consistently demonstrating a minimum of "adequate" in every area of Knowledge and Skill detailed in this checklist and that I do not require additional training or experience in any area to become occupationally competent.';
  const confirmationText = `By signing below, I formally confirm that I am ready to undertake the ${assessmentName} Assessment.`;
  const note =
    "NET will only accept dated signatures within 6 months of the gateway application.";

  return {
    id: "candidate-readiness-declaration",
    title: "Candidate Declaration of Readiness for Assessment",
    assessmentName,
    bodyText,
    paragraphs: [bodyText],
    confirmationText,
    note,
    signatureImage,
    imageUrl: signatureImage.imageUrl,
    signatureImageUrl: signatureImage.signatureImageUrl,
    previewUrl: signatureImage.previewUrl,
    available: signatureImage.available,
    printName,
    printNameValue: printName,
    candidateName: printName,
    dateValue: signedDate,
    date: signedDate,
    dateLabel: signedDateLabel,
    fields: [
      {
        id: "candidateSignature",
        label: "Candidate Signature",
        type: "signature",
        value: signatureImage.imageUrl,
        defaultValue: signatureImage.imageUrl,
        imageUrl: signatureImage.imageUrl,
        required: true,
      },
      {
        id: "printName",
        label: "Print Name",
        type: "text",
        value: printName,
        defaultValue: printName,
        autoFillFrom: "candidate.fullName",
        required: true,
      },
      {
        id: "date",
        label: "Date",
        type: "date",
        value: signedDate,
        defaultValue: signedDate,
        required: true,
      },
    ],
  };
}

function buildAm2ChecklistFlowPreview(course, options = {}) {
  const checklistMetadata = getChecklistVariantMetadata("am2");
  const candidateDeclaration = buildCandidateReadinessDeclaration(
    "am2",
    options.signature || {},
    options
  );
  const trainingProviderSignature = buildTrainingProviderSignaturePayload(
    options.trainingProviderSignature || {}
  );
  const checklistTemplates = buildChecklistTemplates("am2");
  const checklistSections = checklistTemplates.map((section) => ({
    id: section.id,
    key: section.key,
    label: section.label,
    title: section.title,
    duration: section.duration,
    summary: section.summary,
    totalItems: section.items.length,
    items: section.items.map((item, index) =>
      buildChecklistFlowItem(item, section.id, index)
    ),
  }));

  return {
    course: {
      id: String(course._id),
      title: course.title || "",
      slug: course.slug || "",
      qualification: course.qualification || "",
      assessmentVariant: normalizeChecklistVariant(course.assessmentVariant) || "am2",
      location: course.location || "",
      schedule: course.schedule || "",
      duration: course.duration || "",
      price: course.price || 0,
      currency: course.currency || "GBP",
      thumbnailUrl: course.thumbnailUrl || course.galleryImages?.[0] || "",
      galleryImages: course.galleryImages || [],
    },
    checklistVariant: "am2",
    flow: {
      steps: BOOKING_FLOW_STEPS.map((step, index) => ({
        ...step,
        order: index + 1,
      })),
      documents: {
        title: "Upload Full Certificate",
        subtitle: "For those who don't already hold AM2",
        importantInformation: "You must upload all required documents before proceeding.",
        requirements: [
          {
            id: "full_certificate",
            title: "Learner History Report or Walled Garden Report (City & Guilds)",
            description: "Requirements from your provider",
            acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
          },
        ],
      },
      checklistSummary: {
        title: checklistMetadata.title,
        subtitle: checklistMetadata.subtitle,
        templateId: checklistMetadata.templateId,
        overallCompletion: 0,
        importantInformation: "Important Information",
        notice:
          "Complete all sections of the checklist. You can use the full checklist page for a detailed view.",
      },
      checklistSections,
      candidateDeclaration,
      trainingProviderSignature,
      signatures: {
        candidate: {
          supportedTypes: ["draw", "upload"],
          uploadFields: ["file", "image", "signature", "candidateSignature"],
          fields: candidateDeclaration.fields,
          signatureImage: candidateDeclaration.signatureImage,
          imageUrl: candidateDeclaration.imageUrl,
          signatureImageUrl: candidateDeclaration.signatureImageUrl,
          previewUrl: candidateDeclaration.previewUrl,
          date: candidateDeclaration.date,
          dateValue: candidateDeclaration.dateValue,
          dateLabel: candidateDeclaration.dateLabel,
          declaration: candidateDeclaration,
        },
        trainingProvider: {
          fields: ["trainingProviderEmail", "trainingProviderName", "subject", "message"],
          signature: trainingProviderSignature,
          signatureImage: trainingProviderSignature.signatureImage,
          imageUrl: trainingProviderSignature.imageUrl,
          signatureImageUrl: trainingProviderSignature.signatureImageUrl,
          previewUrl: trainingProviderSignature.previewUrl,
          date: trainingProviderSignature.date,
          dateValue: trainingProviderSignature.dateValue,
          dateLabel: trainingProviderSignature.dateLabel,
        },
      },
      submit: {
        title: "Review & Submit",
        checks: [
          "NET Candidate Registration Form",
          checklistMetadata.title,
          "Candidate Signature",
          "Training Provider Signature",
        ],
      },
      reviewStates: [
        { key: "submitted", label: "Application Submitted" },
        { key: "under_review", label: "Under Review" },
        { key: "approved", label: "Application Approved" },
      ],
      payment: {
        title: "Proceed to Payment",
        availableAfterApproval: true,
      },
      confirmed: {
        title: "Booking Confirmed",
      },
    },
    coverage: buildAm2ChecklistFlowCoverageReport(),
  };
}

function buildAm2eChecklistCoverageReport(variant) {
  if (variant === "am2e") {
    return {
      checklistCoverage: {
        matched: [
          "AM2E Full Checklist from the NET 03.26 PDF",
          "Section A1 with 2 checklist items",
          "Sections A2-A6 with 21 checklist items",
          "Section B with 13 checklist items",
          "Section C with 3 checklist items",
          "Section D with 5 checklist items",
          "Section E with 4 checklist items",
          "Knowledge level options: Extensive, Adequate, Limited, Unsure",
          "Experience level options: Extensive, Adequate, Limited, Unsure",
          "Eligibility branch uses qualification selection plus NVQ registration date",
        ],
        missingFields: [],
        mismatches: [
          {
            field: "eligibility branch persistence",
            status: "backend_preview_only",
            note:
              "These endpoints return the checklist variant definition by course and branch rule, but they do not yet persist the chosen branch onto a booking record automatically.",
          },
        ],
        notes: [
          "The AM2E route selected by before-3rd-september-2023 now returns the full AM2E checklist questions from the provided NET PDF.",
        ],
      },
    };
  }

  if (variant === "am2e-v1") {
    return {
      checklistCoverage: {
        matched: [
          "AM2E v1 Full Checklist from the NET 02.25 PDF",
          "Section A1 with 2 checklist items",
          "Sections A2-A6 with 21 checklist items",
          "Section B with 13 checklist items",
          "Section C with 3 checklist items",
          "Section D with 5 checklist items",
          "Section E with 4 checklist items",
          "Knowledge level options: Extensive, Adequate, Limited, Unsure",
          "Experience level options: Extensive, Adequate, Limited, Unsure",
          "Eligibility branch uses qualification selection plus NVQ registration date",
        ],
        missingFields: [],
        mismatches: [
          {
            field: "eligibility branch persistence",
            status: "backend_preview_only",
            note:
              "These endpoints return the checklist variant definition by course and branch rule, but they do not yet persist the chosen branch onto a booking record automatically.",
          },
        ],
        notes: [
          "The AM2E v1 route selected by after-september-2023 now returns the full AM2E v1 checklist questions from the provided NET PDF.",
        ],
      },
    };
  }

  return {
    checklistCoverage: {
      matched: [
        `Checklist title switches to ${variant === "am2e-v1" ? "AM2E V1 Checklist" : "AM2E Checklist"}`,
        "Section counts remain aligned with the AM2-style self-assessment flow",
        "Documents step is variant-specific for experienced worker journeys",
        "Eligibility branch uses qualification selection plus NVQ registration date",
      ],
      missingFields: [],
      mismatches: [
        {
          field: "eligibility branch persistence",
          status: "backend_preview_only",
          note:
            "These endpoints return the checklist variant definition by course and branch rule, but they do not yet persist the chosen branch onto a booking record automatically.",
        },
      ],
      notes: [
        "Use the qualification selection plus NVQ registration date to decide whether to call the AM2E or AM2E V1 variant endpoint.",
        "The screenshots suggest the same checklist section structure with different document requirements and checklist naming.",
      ],
    },
  };
}

function buildAm2eVariantDocumentRequirements(variant) {
  if (variant === "am2e-v1") {
    return [
      {
        id: "experienced-worker-qualification-certificate",
        title: "The Experienced Worker Qualification Certificate",
        description: "Issued from your City & Guilds 2346 or 2347, 2357, or equivalent route",
        acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
      },
      {
        id: "walled-garden-report",
        title: "City & Guilds Walled Garden Report or EAL Learner History Report",
        description: "This will need to support the claim you hold or held the relevant qualification",
        acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
      },
      {
        id: "skills-scan-pre-september-2023",
        title: "Skills Scan (Pre-Sept 2023)",
        description:
          "This form dated September 2023 onwards will be replaced. You will need to request this from the JIB if you require it.",
        acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
      },
      {
        id: "level-2-or-level-3-technical-certificate",
        title: "Level 2 or Level 3 Technical Certificate",
        description:
          "For overseas candidates an Electrotechnical Statement from Ecctis (formerly UK NARIC) is required to show UK equivalency if you do not hold a UK Level 2 or 3 technical certificate.",
        acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
      },
    ];
  }

  return [
    {
      id: "experienced-worker-qualification-certificate",
      title: "The Experienced Worker Qualification Certificate",
      description: "Issued from your City & Guilds 2346 or 2347, 2357, or equivalent route",
      acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
    },
    {
      id: "walled-garden-report",
      title: "City & Guilds Walled Garden Report or EAL Learner History Report",
      description: "This will need to support the claim you hold or held the relevant qualification",
      acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
    },
    {
      id: "skills-scan-pre-september-2023",
      title: "Skills Scan (Pre-Sept 2023)",
      description: "This form dated September 2023 onwards will be replaced. You will need to request this from the JIB if you require it.",
      acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
    },
  ];
}

function buildEligibilityBranchingRules() {
  return {
    qualificationStep: {
      id: "qualification-check",
      question: "Have you completed or are you registered for any of the following qualifications?",
      acceptedRouteIds: [
        "ewa-city-and-guilds-2346",
        "eal-603-5982-1",
        "city-and-guilds-2357",
        "eal-501-1065-b-electrotechnical",
        "eal-501-1064-a-electrotechnical-maintenance",
        "city-and-guilds-2356-certificate-nvq",
        "city-and-guilds-2355-03-certificate-nvq",
        "eal-100-4720-7-certificates-in-electrotechnical-services-nvq",
        "city-and-guilds-2356-99-jib-mature-candidate-assessment-route",
        "eal-ets3-jib-mature-candidate-assessment-route",
        "city-and-guilds-2360-part-1-and-2",
        "level-3-or-level-4-diplomas-in-electrotechnical-studies-and-practice",
      ],
    },
    nvqRegistrationDateStep: {
      id: "nvq-registration-date",
      question: "When did you register for your NVQ?",
      options: [
        {
          id: "before-3rd-september-2023",
          label: "Before 3rd September 2023",
          leadsToVariant: "am2e",
        },
        {
          id: "after-september-2023",
          label: "After September 2023",
          leadsToVariant: "am2e-v1",
        },
      ],
    },
  };
}

function findEligibilityOptionById(answerId) {
  const normalizedAnswerId = normalizeString(answerId);
  const options = buildEligibilityBranchingRules().nvqRegistrationDateStep.options;

  return options.find((option) => option.id === normalizedAnswerId) || null;
}

function resolveAm2eChecklistVariant(requestedVariant, query = {}) {
  const questionId = normalizeString(query.questionId || query.question || query.stepId);
  const answerId = normalizeString(query.answerId || query.selectedAnswerId || query.optionId);
  const selectedOption = findEligibilityOptionById(answerId);

  if (!answerId) {
    return {
      variant: requestedVariant,
      selectedQuestionId: questionId,
      selectedAnswerId: "",
      selectedAnswer: null,
      routeSource: "default",
    };
  }

  if (questionId && questionId !== "nvq-registration-date") {
    return {
      error: "questionId must be nvq-registration-date when answerId is provided",
    };
  }

  if (!selectedOption) {
    return {
      error: "Invalid answerId for nvq-registration-date",
    };
  }

  return {
    variant: selectedOption.leadsToVariant,
    selectedQuestionId: "nvq-registration-date",
    selectedAnswerId: selectedOption.id,
    selectedAnswer: selectedOption,
    routeSource: "eligibility-answer",
  };
}

function buildAm2eChecklistFlowPreview(course, variant, options = {}) {
  const checklistMetadata = getChecklistVariantMetadata(variant);
  const candidateDeclaration = buildCandidateReadinessDeclaration(
    variant,
    options.signature || {},
    options
  );
  const trainingProviderSignature = buildTrainingProviderSignaturePayload(
    options.trainingProviderSignature || {}
  );
  const checklistTemplates = buildChecklistTemplates(variant);
  const checklistSections = checklistTemplates.map((section) => ({
    id: section.id,
    key: section.key,
    label: section.label,
    title: section.title,
    duration: section.duration,
    summary: section.summary,
    totalItems: section.items.length,
    items: section.items.map((item, index) =>
      buildChecklistFlowItem(item, section.id, index)
    ),
  }));

  return {
    course: {
      id: String(course._id),
      title: course.title || "",
      slug: course.slug || "",
      qualification: course.qualification || "",
      assessmentVariant: normalizeChecklistVariant(course.assessmentVariant) || variant,
      location: course.location || "",
      schedule: course.schedule || "",
      duration: course.duration || "",
      price: course.price || 0,
      currency: course.currency || "GBP",
      thumbnailUrl: course.thumbnailUrl || course.galleryImages?.[0] || "",
      galleryImages: course.galleryImages || [],
    },
    checklistVariant: variant,
    resolvedFrom: {
      routeVariant: variant,
    },
    eligibilityRouting: buildEligibilityBranchingRules(),
    flow: {
      steps: BOOKING_FLOW_STEPS.map((step, index) => ({
        ...step,
        order: index + 1,
      })),
      documents: {
        title: "Upload Full Certificate",
        subtitle: "For those who don't already hold AM2",
        importantInformation:
          "You must upload all required documents before proceeding.",
        requirements: buildAm2eVariantDocumentRequirements(variant),
      },
      checklistSummary: {
        title: checklistMetadata.title,
        subtitle: checklistMetadata.subtitle,
        templateId: checklistMetadata.templateId,
        overallCompletion: 0,
        importantInformation: "Important Information",
        notice:
          "Complete all sections of the checklist. You can use the full checklist page for a detailed view.",
      },
      checklistSections,
      candidateDeclaration,
      trainingProviderSignature,
      signatures: {
        candidate: {
          supportedTypes: ["draw", "upload"],
          uploadFields: ["file", "image", "signature", "candidateSignature"],
          fields: candidateDeclaration.fields,
          signatureImage: candidateDeclaration.signatureImage,
          imageUrl: candidateDeclaration.imageUrl,
          signatureImageUrl: candidateDeclaration.signatureImageUrl,
          previewUrl: candidateDeclaration.previewUrl,
          date: candidateDeclaration.date,
          dateValue: candidateDeclaration.dateValue,
          dateLabel: candidateDeclaration.dateLabel,
          declaration: candidateDeclaration,
        },
        trainingProvider: {
          fields: ["trainingProviderEmail", "trainingProviderName", "subject", "message"],
          signature: trainingProviderSignature,
          signatureImage: trainingProviderSignature.signatureImage,
          imageUrl: trainingProviderSignature.imageUrl,
          signatureImageUrl: trainingProviderSignature.signatureImageUrl,
          previewUrl: trainingProviderSignature.previewUrl,
          date: trainingProviderSignature.date,
          dateValue: trainingProviderSignature.dateValue,
          dateLabel: trainingProviderSignature.dateLabel,
        },
      },
      submit: {
        title: "Review & Submit",
        checks: [
          "NET Candidate Registration Form",
          checklistMetadata.title,
          "Candidate Signature",
          "Training Provider Signature",
        ],
      },
      reviewStates: [
        { key: "submitted", label: "Application Submitted" },
        { key: "under_review", label: "Under Review" },
        { key: "approved", label: "Application Approved" },
      ],
      payment: {
        title: "Proceed to Payment",
        availableAfterApproval: true,
      },
      confirmed: {
        title: "Booking Confirmed",
      },
    },
    coverage: buildAm2eChecklistCoverageReport(variant),
  };
}

async function findChecklistCourseById(courseId) {
  if (!courseId) {
    return {
      status: 400,
      error: "courseId is required",
    };
  }

  if (!mongoose.isValidObjectId(courseId)) {
    return {
      status: 400,
      error: "Invalid courseId",
    };
  }

  const course = await Course.findById(courseId).select(
    "_id title slug qualification assessmentVariant assessmentVariantPricing shortDescription location schedule duration price currency vatEnabled thumbnailUrl galleryImages"
  );

  if (!course) {
    return {
      status: 404,
      error: "Course not found",
    };
  }

  return { course };
}

async function findChecklistFlowBookingContext(courseId, req) {
  const bookingId = normalizeString(
    req.query?.bookingId ||
      req.query?.booking ||
      req.query?.booking_id ||
      req.query?.id ||
      req.query?._id
  );

  if (bookingId && !mongoose.isValidObjectId(bookingId)) {
    return {
      status: 400,
      error: "Invalid booking id",
    };
  }

  if (!req.user && !bookingId) {
    return { booking: null };
  }

  const query = {
    course: courseId,
  };

  if (bookingId) {
    query._id = bookingId;
  }

  if (req.user && req.user.role !== "admin") {
    query.user = req.user.id;
  }

  const booking = await Booking.findOne(query)
    .populate(
      "course",
      "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections thumbnailUrl"
    )
    .sort({
      "candidateSignature.signedAt": -1,
      "trainingProviderSignature.signedAt": -1,
      updatedAt: -1,
      createdAt: -1,
    });

  if (bookingId && !booking) {
    return {
      status: 404,
      error: "Booking not found for this course",
    };
  }

  return { booking: booking || null };
}

async function buildChecklistFlowResponseDataForRequest(course, variantResult, req) {
  const bookingContext = await findChecklistFlowBookingContext(course._id, req);

  if (bookingContext.error) {
    return bookingContext;
  }

  return {
    data: buildChecklistFlowResponseData(course, variantResult, {
      ...(req.query || {}),
      __bookingContext: bookingContext.booking,
    }),
  };
}

function inferChecklistVariantFromCourse(course) {
  const explicitVariant = normalizeChecklistVariant(course?.assessmentVariant);
  if (explicitVariant) {
    return {
      variant: explicitVariant,
      source: "course.assessmentVariant",
    };
  }

  const searchableCourseText = [
    course?.title,
    course?.slug,
    course?.qualification,
    course?.shortDescription,
  ]
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (/\bam2e[\s_-]*v?1\b/.test(searchableCourseText)) {
    return {
      variant: "am2e-v1",
      source: "course-text-inference",
    };
  }

  if (/\bam2e\b/.test(searchableCourseText)) {
    return {
      variant: "am2e",
      source: "course-text-inference",
    };
  }

  if (/\bam2\b/.test(searchableCourseText)) {
    return {
      variant: "am2",
      source: "course-text-inference",
    };
  }

  return {
    variant: "am2",
    source: "default",
  };
}

function buildChecklistVariantApiUrl(variant, courseId, query = {}) {
  const params = new URLSearchParams({
    courseId: String(courseId),
  });
  const questionId = normalizeString(query.questionId || query.question || query.stepId);
  const answerId = normalizeString(query.answerId || query.selectedAnswerId || query.optionId);

  if (questionId) {
    params.set("questionId", questionId);
  }

  if (answerId) {
    params.set("answerId", answerId);
  }

  if (variant === "am2e") {
    return `/api/bookings/am2e-checklist-flow?${params.toString()}`;
  }

  if (variant === "am2e-v1") {
    return `/api/bookings/am2e-v1-checklist-flow?${params.toString()}`;
  }

  return `/api/bookings/am2-checklist-flow?${params.toString()}`;
}

function buildUnifiedChecklistFlowApiUrl(courseId, query = {}, resolvedVariant = "") {
  const params = new URLSearchParams({
    courseId: String(courseId),
  });
  const questionId = normalizeString(query.questionId || query.question || query.stepId);
  const answerId = normalizeString(query.answerId || query.selectedAnswerId || query.optionId);
  const variant = normalizeChecklistVariant(
    resolvedVariant || query.assessmentVariant || query.checklistVariant || query.variant
  );

  if (variant) {
    params.set("variant", variant);
  }

  if (questionId) {
    params.set("questionId", questionId);
  }

  if (answerId) {
    params.set("answerId", answerId);
  }

  return `/api/bookings/checklist-flow?${params.toString()}`;
}

function resolveChecklistVariantForCourse(course, query = {}, options = {}) {
  const routeVariant = normalizeChecklistVariant(options.routeVariant);
  const requestedVariantRaw = normalizeString(
    query.assessmentVariant || query.checklistVariant || query.variant
  );
  const requestedVariant = normalizeChecklistVariant(requestedVariantRaw);
  const answerId = normalizeString(query.answerId || query.selectedAnswerId || query.optionId);
  const courseVariant = inferChecklistVariantFromCourse(course);

  if (requestedVariantRaw && !requestedVariant) {
    return {
      error: "variant must be one of am2, am2e, or am2e-v1",
    };
  }

  if (answerId) {
    const variantResult = resolveAm2eChecklistVariant(
      requestedVariant || routeVariant || courseVariant.variant || "am2e",
      query
    );

    if (variantResult.error) {
      return variantResult;
    }

    return {
      ...variantResult,
      variant: variantResult.variant,
      routeVariant: routeVariant || "",
      requestedVariant: requestedVariant || "",
      courseVariant: courseVariant.variant,
      courseVariantSource: courseVariant.source,
      source: "eligibility-answer",
    };
  }

  if (requestedVariant) {
    return {
      variant: requestedVariant,
      selectedQuestionId: "",
      selectedAnswerId: "",
      selectedAnswer: null,
      routeSource: "query-variant",
      routeVariant: routeVariant || "",
      requestedVariant,
      courseVariant: courseVariant.variant,
      courseVariantSource: courseVariant.source,
      source: "query-variant",
    };
  }

  if (routeVariant) {
    return {
      variant: routeVariant,
      selectedQuestionId: "",
      selectedAnswerId: "",
      selectedAnswer: null,
      routeSource: "route-default",
      routeVariant,
      requestedVariant: "",
      courseVariant: courseVariant.variant,
      courseVariantSource: courseVariant.source,
      source: "route-default",
    };
  }

  return {
    variant: courseVariant.variant,
    selectedQuestionId: "",
    selectedAnswerId: "",
    selectedAnswer: null,
    routeSource: courseVariant.source,
    routeVariant: "",
    requestedVariant: "",
    courseVariant: courseVariant.variant,
    courseVariantSource: courseVariant.source,
    source: courseVariant.source,
  };
}

function isCourseDocument(course) {
  return course?.constructor?.modelName === "Course";
}

function buildCoursePricingForFlow(course, variant) {
  if (
    isAssessmentVariantPricingCourse(course) &&
    !course?.assessmentVariantPricing &&
    !isCourseDocument(course)
  ) {
    return buildPricingDisplay({
      amount: course?.price || 0,
      currency: course?.currency || "GBP",
      vatEnabled: Boolean(course?.vatEnabled),
    });
  }

  return buildCoursePricing(course, { assessmentVariant: variant });
}

function buildAvailableChecklistVariants(course) {
  const courseId = String(course?._id || course || "");

  return CHECKLIST_VARIANTS.map((variant) => {
    const metadata = getChecklistVariantMetadata(variant);
    const pricing = buildCoursePricingForFlow(course, variant);

    return {
      variant,
      templateId: metadata.templateId,
      title: metadata.title,
      description: metadata.description,
      price: pricing.amount,
      currency: pricing.currency,
      displayPrice: pricing.baseDisplayPrice,
      pricing,
      apiUrl: buildChecklistVariantApiUrl(variant, courseId),
    };
  });
}

function buildChecklistVariantSummary(course, variantResult, query = {}) {
  const metadata = getChecklistVariantMetadata(variantResult.variant);
  const courseId = String(course._id);
  const pricing = buildCoursePricingForFlow(course, variantResult.variant);

  return {
    course: {
      id: courseId,
      title: course.title || "",
      slug: course.slug || "",
      qualification: course.qualification || "",
      assessmentVariant: variantResult.variant,
      selectedAssessmentVariant: variantResult.variant,
      configuredAssessmentVariant:
        normalizeChecklistVariant(course.assessmentVariant) || variantResult.courseVariant || "am2",
      price: pricing.amount,
      currency: pricing.currency,
      displayPrice: pricing.baseDisplayPrice,
      pricing,
      assessmentVariantPricing: isCourseDocument(course) ? buildAssessmentVariantPricing(course) : null,
    },
    checklistVariant: variantResult.variant,
    assessmentVariant: variantResult.variant,
    templateId: metadata.templateId,
    title: metadata.title,
    description: metadata.description,
    resolvedFrom: {
      source: variantResult.source || variantResult.routeSource || "default",
      routeVariant: variantResult.routeVariant || "",
      requestedVariant: variantResult.requestedVariant || "",
      courseVariant: variantResult.courseVariant || "am2",
      courseVariantSource: variantResult.courseVariantSource || "default",
      selectedQuestionId: variantResult.selectedQuestionId || "",
      selectedAnswerId: variantResult.selectedAnswerId || "",
      selectedAnswerLabel: variantResult.selectedAnswer?.label || "",
    },
    api: {
      canonicalFlowUrl: buildUnifiedChecklistFlowApiUrl(courseId, query, variantResult.variant),
      legacyFlowUrl: buildChecklistVariantApiUrl(variantResult.variant, courseId, query),
    },
    pdfExport: {
      checklistVariant: variantResult.variant,
      templateId: metadata.templateId,
      title: metadata.title,
      flowUrl: buildUnifiedChecklistFlowApiUrl(courseId, query, variantResult.variant),
    },
    availableVariants: buildAvailableChecklistVariants(course),
  };
}

function buildChecklistFlowResponseData(course, variantResult, query = {}) {
  const booking = query.__bookingContext || null;
  const candidateDeclarationOptions = {
    printName:
      booking?.personalDetails?.fullName ||
      getCandidatePrintNameFromQuery(query) ||
      booking?.candidateSignature?.signerName ||
      "",
    signature: booking?.candidateSignature || {},
    trainingProviderSignature: booking?.trainingProviderSignature || {},
  };
  const responseData =
    variantResult.variant === "am2"
      ? buildAm2ChecklistFlowPreview(course, candidateDeclarationOptions)
      : buildAm2eChecklistFlowPreview(course, variantResult.variant, candidateDeclarationOptions);
  const variantSummary = buildChecklistVariantSummary(course, variantResult, query);

  responseData.checklistVariant = variantResult.variant;
  responseData.assessmentVariant = variantResult.variant;
  responseData.resolvedFrom = variantSummary.resolvedFrom;
  responseData.pdfExport = variantSummary.pdfExport;
  responseData.availableVariants = variantSummary.availableVariants;

  if (responseData.course) {
    responseData.course.assessmentVariant = variantSummary.course.assessmentVariant;
    responseData.course.selectedAssessmentVariant = variantSummary.course.selectedAssessmentVariant;
    responseData.course.configuredAssessmentVariant = variantSummary.course.configuredAssessmentVariant;
    responseData.course.price = variantSummary.course.price;
    responseData.course.currency = variantSummary.course.currency;
    responseData.course.displayPrice = variantSummary.course.displayPrice;
    responseData.course.pricing = variantSummary.course.pricing;
    responseData.course.assessmentVariantPricing = variantSummary.course.assessmentVariantPricing;
  }

  const candidateSignature = {
    ...(responseData.flow?.candidateDeclaration?.signatureImage || buildCandidateSignatureImagePayload()),
    printName: responseData.flow?.candidateDeclaration?.printName || "",
    signerName: booking?.candidateSignature?.signerName || responseData.flow?.candidateDeclaration?.printName || "",
    signerEmail: booking?.candidateSignature?.signerEmail || "",
  };
  const trainingProviderSignature =
    responseData.flow?.trainingProviderSignature || buildTrainingProviderSignaturePayload();

  responseData.candidateSignature = candidateSignature;
  responseData.trainingProviderSignature = trainingProviderSignature;
  responseData.signatures = {
    candidate: candidateSignature,
    trainingProvider: trainingProviderSignature,
    candidateSignature: candidateSignature.url || candidateSignature.imageUrl || null,
    trainingProviderSignature: trainingProviderSignature.url || trainingProviderSignature.imageUrl || null,
  };
  responseData.signatureImages = {
    candidate: {
      url: candidateSignature.url || candidateSignature.imageUrl || null,
      imageUrl: candidateSignature.imageUrl,
      signatureImageUrl: candidateSignature.signatureImageUrl,
      previewUrl: candidateSignature.previewUrl,
      available: candidateSignature.available,
      date: candidateSignature.date,
      dateValue: candidateSignature.dateValue,
      dateLabel: candidateSignature.dateLabel,
    },
    trainingProvider: {
      url: trainingProviderSignature.url || trainingProviderSignature.imageUrl || null,
      imageUrl: trainingProviderSignature.imageUrl,
      signatureImageUrl: trainingProviderSignature.signatureImageUrl,
      previewUrl: trainingProviderSignature.previewUrl,
      available: trainingProviderSignature.available,
      date: trainingProviderSignature.date,
      dateValue: trainingProviderSignature.dateValue,
      dateLabel: trainingProviderSignature.dateLabel,
    },
  };

  if (booking) {
    responseData.bookingContext = {
      id: String(booking._id),
      bookingNumber: booking.bookingNumber || "",
      candidateName: booking.personalDetails?.fullName || "",
      candidateSignatureStatus: getCandidateSignatureStatus(booking),
      trainingProviderSignatureStatus: getTrainingProviderSignatureStatus(booking),
      candidateSignature: responseData.candidateSignature,
      trainingProviderSignature: responseData.trainingProviderSignature,
      signatureImages: responseData.signatureImages,
    };
  }

  return responseData;
}

function buildBookingChecklistVariantMetadata(booking) {
  const variant = getChecklistVariantForBooking(booking);
  const metadata = getChecklistVariantMetadata(variant);
  const courseId = String(booking?.course?._id || booking?.course || "");
  const selectedAnswerId = normalizeString(booking?.eligibilityCheck?.nvqRegistrationDate);
  const hasSavedResponses = Array.isArray(booking?.checklistResponses) && booking.checklistResponses.length > 0;
  const query = {
    variant,
  };

  if (selectedAnswerId) {
    query.questionId = "nvq-registration-date";
    query.answerId = selectedAnswerId;
  }

  return {
    checklistVariant: variant,
    assessmentVariant: variant,
    templateId: metadata.templateId,
    title: metadata.title,
    description: metadata.description,
    resolvedFrom: {
      source: selectedAnswerId ? "booking.eligibilityCheck.nvqRegistrationDate" : "booking.course",
      selectedQuestionId: selectedAnswerId ? "nvq-registration-date" : "",
      selectedAnswerId,
      selectedAnswerLabel: findEligibilityOptionById(selectedAnswerId)?.label || "",
    },
    pdfExport: {
      checklistVariant: variant,
      assessmentVariant: variant,
      templateId: metadata.templateId,
      title: metadata.title,
      hasSavedResponses,
      bookingChecklistUrl: `/api/bookings/${booking._id}/flow/checklist/full`,
      courseFlowUrl: courseId ? buildUnifiedChecklistFlowApiUrl(courseId, query, variant) : "",
    },
  };
}

function buildBookingChecklistFlowCourse(booking) {
  const course = booking.course && typeof booking.course === "object" ? booking.course : {};
  const variant = getChecklistVariantForBooking(booking);

  return {
    _id: course._id || booking.course || "",
    title: course.title || booking.courseSnapshot?.title || "",
    slug: course.slug || booking.courseSnapshot?.slug || "",
    qualification: course.qualification || booking.courseSnapshot?.qualification || "",
    assessmentVariant: variant,
    shortDescription: course.shortDescription || "",
    location: course.location || booking.courseSnapshot?.location || "",
    schedule: course.schedule || booking.courseSnapshot?.schedule || "",
    duration: course.duration || booking.courseSnapshot?.duration || "",
    price: booking.payment?.amount ?? booking.courseSnapshot?.price ?? 0,
    currency: booking.payment?.currency || booking.courseSnapshot?.currency || "GBP",
    thumbnailUrl: booking.courseSnapshot?.thumbnailUrl || course.thumbnailUrl || "",
    galleryImages: course.galleryImages || [],
  };
}

function buildBookingChecklistFlowResponse(booking) {
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);
  const course = buildBookingChecklistFlowCourse(booking);
  const variantResult = {
    variant: variantMetadata.checklistVariant,
    routeVariant: variantMetadata.checklistVariant,
    requestedVariant: "",
    courseVariant: variantMetadata.assessmentVariant,
    courseVariantSource: variantMetadata.resolvedFrom.source,
    source: variantMetadata.resolvedFrom.source,
    selectedQuestionId: variantMetadata.resolvedFrom.selectedQuestionId,
    selectedAnswerId: variantMetadata.resolvedFrom.selectedAnswerId,
    selectedAnswer: variantMetadata.resolvedFrom.selectedAnswerId
      ? {
          label: variantMetadata.resolvedFrom.selectedAnswerLabel,
        }
      : null,
  };
  const responseData = buildChecklistFlowResponseData(course, variantResult, {
    variant: variantMetadata.checklistVariant,
    questionId: variantMetadata.resolvedFrom.selectedQuestionId,
    answerId: variantMetadata.resolvedFrom.selectedAnswerId,
    __bookingContext: booking,
  });

  responseData.availableVariants = (responseData.availableVariants || []).filter(
    (item) => item.variant === variantMetadata.checklistVariant
  );

  const documentPayload = buildAdminBookingDocumentsPayload(booking);

  responseData.flow = {
    ...(responseData.flow || {}),
    documents: {
      ...(responseData.flow?.documents || {}),
      requirements: documentPayload.requirements,
      uploadedItems: documentPayload.documentItems,
      completion: documentPayload.completion,
      uploadApiUrl: documentPayload.uploadApiUrl,
    },
  };

  return responseData;
}

function buildCourseSnapshot(course, assessmentVariant) {
  const selectedVariant = normalizeChecklistVariant(assessmentVariant || course.assessmentVariant) || "am2";
  const pricing = calculateVatPricing(
    resolveAssessmentVariantPriceForCourse(course, selectedVariant),
    course.vatEnabled
  );

  return {
    title: course.title,
    slug: course.slug,
    schedule: course.schedule || "",
    duration: course.duration || "",
    qualification: course.qualification || "",
    assessmentVariant: selectedVariant,
    location: course.location || "",
    thumbnailUrl: course.thumbnailUrl || course.galleryImages?.[0] || "",
    price: pricing.amount,
    vatEnabled: pricing.vatEnabled,
    vatRate: pricing.vatRate,
    vatAmount: pricing.vatAmount,
    totalPrice: pricing.totalAmount,
    currency: course.currency || "GBP",
  };
}

function getPersonalDetailsInput(body) {
  if (body && typeof body.personalDetails === "object" && body.personalDetails !== null) {
    return body.personalDetails;
  }

  return body || {};
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getMailDeliveryFailureMessage(error) {
  if (error?.message === "SMTP is not configured") {
    return "SMTP is not configured";
  }

  if (error?.code === "EAUTH") {
    return "SMTP authentication failed. Check SMTP_USER and SMTP_PASS.";
  }

  if (
    error?.code === "ETIMEDOUT" ||
    error?.code === "ESOCKET" ||
    /timeout|timed out/i.test(error?.message || "")
  ) {
    return "SMTP server timed out. Check SMTP_HOST, SMTP_PORT, and network access.";
  }

  return "Training provider signature email could not be sent right now";
}

function getBookingApprovalMailFailureMessage(error) {
  const message = getMailDeliveryFailureMessage(error);

  return message === "Training provider signature email could not be sent right now"
    ? "Booking approval email could not be sent right now"
    : message;
}

function buildBookingApprovalEmailPayload(booking) {
  const candidateEmail = normalizeEmail(booking.personalDetails?.email || booking.user?.email);
  const isPaid = booking.payment?.status === "paid";

  return {
    to: candidateEmail,
    candidateName:
      normalizeString(booking.personalDetails?.fullName) ||
      normalizeString(booking.user?.name) ||
      "Candidate",
    courseTitle: normalizeString(booking.courseSnapshot?.title) || "your course",
    bookingNumber: booking.bookingNumber || "",
    paymentUrl: getBookingPaymentFrontendUrl(booking),
    paymentApiUrl: booking?._id ? `/api/bookings/${booking._id}/checkout/payment` : "",
    amountLabel: formatDisplayPrice(
      booking.payment?.amount || 0,
      booking.payment?.currency || booking.courseSnapshot?.currency || "GBP"
    ),
    isPaid,
  };
}

async function sendBookingApprovalEmailForBooking(booking) {
  const payload = buildBookingApprovalEmailPayload(booking);

  if (!payload.to || !validateEmail(payload.to)) {
    return {
      attempted: false,
      sent: false,
      to: payload.to || "",
      message: "Candidate email is missing",
    };
  }

  try {
    await sendBookingApprovalEmail(payload);

    return {
      attempted: true,
      sent: true,
      to: payload.to,
      message: "Booking approval email sent successfully",
    };
  } catch (emailError) {
    const emailDelivery = {
      attempted: true,
      sent: false,
      to: payload.to,
      message: getBookingApprovalMailFailureMessage(emailError),
    };

    console.error("[booking-approval-email]", emailError?.message || emailError);
    return emailDelivery;
  }
}

function validatePhoneNumber(phoneNumber) {
  return /^[0-9+\-\s()]{7,30}$/.test(phoneNumber);
}

function parseDateOfBirth(value) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return { error: "Date of birth is required" };
  }

  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return { error: "Date of birth must be a valid date" };
  }

  if (date >= new Date()) {
    return { error: "Date of birth must be in the past" };
  }

  return { value: date };
}

function buildPersonalDetails(payload, options = {}) {
  const { partial = false } = options;

  const title = normalizeString(payload.title);
  const firstName = normalizeString(payload.firstName);
  const lastName = normalizeString(payload.lastName);
  const derivedFullName = [firstName, lastName].filter(Boolean).join(" ");
  const fullName = normalizeString(payload.fullName) || derivedFullName;
  const email = normalizeEmail(payload.email);
  const phoneNumber = normalizeString(payload.phoneNumber || payload.mobileNumber);
  const niNumber = normalizeString(payload.niNumber || payload.nationalInsuranceNumber);
  const addressLine1 = normalizeString(payload.addressLine1);
  const addressLine2 = normalizeString(payload.addressLine2);
  const address =
    normalizeString(payload.address) ||
    [addressLine1, addressLine2].filter(Boolean).join(", ");
  const trainingCenter = normalizeString(payload.trainingCenter || payload.location);
  const city = normalizeString(payload.city || payload.town);
  const town = normalizeString(payload.town || payload.city);
  const postcode = normalizeString(payload.postcode);

  const details = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "title")) {
    if (title.length > 30) {
      return { error: "Title must be 30 characters or fewer" };
    }

    details.title = title;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "firstName")) {
    if (firstName && (firstName.length < 2 || firstName.length > 80)) {
      return { error: "First name must be between 2 and 80 characters" };
    }

    details.firstName = firstName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "lastName")) {
    if (lastName && (lastName.length < 2 || lastName.length > 80)) {
      return { error: "Last name must be between 2 and 80 characters" };
    }

    details.lastName = lastName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "fullName")) {
    if (!fullName || fullName.length < 2 || fullName.length > 120) {
      return { error: "Full name must be between 2 and 120 characters" };
    }

    details.fullName = fullName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "email")) {
    if (!validateEmail(email) || email.length > 160) {
      return { error: "A valid email address is required" };
    }

    details.email = email;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "phoneNumber")) {
    if (!validatePhoneNumber(phoneNumber)) {
      return { error: "Phone number must be between 7 and 30 valid characters" };
    }

    details.phoneNumber = phoneNumber;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "mobileNumber") ||
    Object.prototype.hasOwnProperty.call(payload, "phoneNumber")
  ) {
    details.phoneNumber = phoneNumber;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "niNumber") ||
    Object.prototype.hasOwnProperty.call(payload, "nationalInsuranceNumber")
  ) {
    if (niNumber.length > 30) {
      return { error: "NI number must be 30 characters or fewer" };
    }

    details.niNumber = niNumber;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "dateOfBirth")) {
    const dateOfBirthResult = parseDateOfBirth(payload.dateOfBirth);
    if (dateOfBirthResult.error) {
      return { error: dateOfBirthResult.error };
    }

    details.dateOfBirth = dateOfBirthResult.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "address")) {
    if (!address || address.length < 5 || address.length > 250) {
      return { error: "Address must be between 5 and 250 characters" };
    }

    details.address = address;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "addressLine1")) {
    if (addressLine1 && (addressLine1.length < 5 || addressLine1.length > 200)) {
      return { error: "Address line 1 must be between 5 and 200 characters" };
    }

    details.addressLine1 = addressLine1;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "addressLine2")) {
    if (addressLine2.length > 200) {
      return { error: "Address line 2 must be 200 characters or fewer" };
    }

    details.addressLine2 = addressLine2;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "trainingCenter") ||
    Object.prototype.hasOwnProperty.call(payload, "location")
  ) {
    if (!trainingCenter || trainingCenter.length < 2 || trainingCenter.length > 150) {
      return { error: "Training center must be between 2 and 150 characters" };
    }

    details.trainingCenter = trainingCenter;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "city")) {
    if (!city || city.length < 2 || city.length > 120) {
      return { error: "City must be between 2 and 120 characters" };
    }

    details.city = city;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "town") ||
    Object.prototype.hasOwnProperty.call(payload, "city")
  ) {
    if (!town || town.length < 2 || town.length > 120) {
      return { error: "Town must be between 2 and 120 characters" };
    }

    details.town = town;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "postcode")) {
    if (!postcode || postcode.length < 2 || postcode.length > 20) {
      return { error: "Postcode must be between 2 and 20 characters" };
    }

    details.postcode = postcode;
  }

  return { value: details };
}

function buildEligibilityCheck(payload, options = {}) {
  const { partial = false } = options;
  const qualificationId = normalizeString(payload.qualificationId || payload.selectedQualificationId);
  const qualificationLabel = normalizeString(
    payload.qualificationLabel || payload.selectedQualificationLabel || payload.selectedQualification
  );
  const nvqRegistrationDate = normalizeString(payload.nvqRegistrationDate || payload.nvqRegistrationWindow);
  const details = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "qualificationId")) {
    if (!qualificationId || qualificationId.length > 160) {
      return { error: "qualificationId is required and must be 160 characters or fewer" };
    }

    details.qualificationId = qualificationId;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "qualificationLabel") ||
    Object.prototype.hasOwnProperty.call(payload, "selectedQualificationLabel") ||
    Object.prototype.hasOwnProperty.call(payload, "selectedQualification")
  ) {
    if (qualificationLabel.length > 200) {
      return { error: "qualificationLabel must be 200 characters or fewer" };
    }

    details.qualificationLabel = qualificationLabel;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(payload, "nvqRegistrationDate") ||
    Object.prototype.hasOwnProperty.call(payload, "nvqRegistrationWindow")
  ) {
    if (nvqRegistrationDate.length > 80) {
      return { error: "nvqRegistrationDate must be 80 characters or fewer" };
    }

    details.nvqRegistrationDate = nvqRegistrationDate;
  }

  return { value: details };
}

function resolveChecklistRouteFromEligibility(booking) {
  const qualificationId = normalizeString(booking?.eligibilityCheck?.qualificationId);
  const nvqRegistrationDate = normalizeString(booking?.eligibilityCheck?.nvqRegistrationDate);
  const courseId = String(booking?.course?._id || booking?.course || "");

  if (!qualificationId || !nvqRegistrationDate) {
    return {
      routeKey: "am2",
      label: "AM2 Checklist",
      apiUrl: `/api/bookings/am2-checklist-flow?courseId=${encodeURIComponent(courseId)}`,
    };
  }

  const selectedOption = findEligibilityOptionById(nvqRegistrationDate);
  const variant = selectedOption?.leadsToVariant || "am2e";

  return {
    routeKey: variant,
    label: getChecklistVariantMetadata(variant).title,
    apiUrl:
      variant === "am2e-v1"
        ? `/api/bookings/am2e-v1-checklist-flow?courseId=${encodeURIComponent(courseId)}`
        : `/api/bookings/am2e-checklist-flow?courseId=${encodeURIComponent(courseId)}`,
  };
}

function buildAssessmentDetails(payload, options = {}) {
  const { partial = false } = options;
  const details = {};

  const fieldConfig = [
    ["apprentice", 20, true],
    ["uln", 50, false],
    ["funding", 80, true],
    ["awardingBody", 80, true],
    ["reasonableAdjustments", 20, true],
    ["recognitionOfPriorLearning", 20, true],
    ["assessmentType", 80, true],
  ];

  for (const [field, maxLength, required] of fieldConfig) {
    if (!partial || Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = normalizeString(payload[field]);

      if (required && !value) {
        return { error: `${field} is required` };
      }

      if (value.length > maxLength) {
        return { error: `${field} must be ${maxLength} characters or fewer` };
      }

      details[field] = value;
    }
  }

  return { value: details };
}

function buildOrganizationDetails(payload, label, options = {}) {
  const { partial = false } = options;
  const companyName = normalizeString(payload.companyName);
  const email = normalizeEmail(payload.email);
  const contactName = normalizeString(payload.contactName);
  const contactNumber = normalizeString(payload.contactNumber);
  const address1 = normalizeString(payload.address1);
  const address2 = normalizeString(payload.address2);
  const address3 = normalizeString(payload.address3);
  const address4 = normalizeString(payload.address4);
  const town = normalizeString(payload.town);
  const postcode = normalizeString(payload.postcode);
  const details = {};

  const requiredFields = [
    ["companyName", companyName, 160],
    ["email", email, 160],
    ["contactName", contactName, 120],
    ["contactNumber", contactNumber, 30],
    ["address1", address1, 200],
    ["address2", address2, 200],
    ["town", town, 120],
    ["postcode", postcode, 20],
  ];

  for (const [field, value, maxLength] of requiredFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(payload, field)) {
      if (!value) {
        return { error: `${label} ${field} is required` };
      }

      if (value.length > maxLength) {
        return { error: `${label} ${field} must be ${maxLength} characters or fewer` };
      }

      if (field === "email" && !validateEmail(value)) {
        return { error: `${label} email must be a valid email address` };
      }

      if (field === "contactNumber" && !validatePhoneNumber(value)) {
        return { error: `${label} contactNumber must be between 7 and 30 valid characters` };
      }

      details[field] = value;
    }
  }

  const optionalFields = [
    ["address3", address3, 200],
    ["address4", address4, 200],
  ];

  for (const [field, value, maxLength] of optionalFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(payload, field)) {
      if (value.length > maxLength) {
        return { error: `${label} ${field} must be ${maxLength} characters or fewer` };
      }

      details[field] = value;
    }
  }

  return { value: details };
}

function buildPrivacyConfirmation(payload, options = {}) {
  const { partial = false } = options;

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "privacyConfirmation")) {
    const privacyConfirmation = normalizeBoolean(payload.privacyConfirmation, false);

    if (!privacyConfirmation) {
      return { error: "privacyConfirmation must be true" };
    }

    return { value: { privacyConfirmation } };
  }

  return { value: {} };
}

function buildSignaturePayload(payload, options = {}) {
  const { requireData = true } = options;
  const signerName = normalizeString(payload.signerName || payload.name);
  const signerEmail = normalizeEmail(payload.signerEmail || payload.email);
  const signatureType = normalizeString(payload.signatureType || payload.type).toLowerCase();
  const signatureData = normalizeString(
    payload.signatureData || payload.signatureImageUrl || payload.typedSignature || payload.fileUrl
  );
  const fileName = normalizeString(payload.fileName);

  if (signerName && signerName.length > 120) {
    return { error: "signerName must be 120 characters or fewer" };
  }

  if (signerEmail && (!validateEmail(signerEmail) || signerEmail.length > 160)) {
    return { error: "signerEmail must be a valid email address" };
  }

  if (signatureType && !["draw", "upload", "typed"].includes(signatureType)) {
    return { error: "signatureType must be draw, upload, or typed" };
  }

  if (requireData && !signatureData) {
    return { error: "signatureData is required" };
  }

  if (signatureData.length > SIGNATURE_DATA_MAX_LENGTH) {
    return { error: `signatureData must be ${SIGNATURE_DATA_MAX_LENGTH} characters or fewer` };
  }

  if (fileName.length > 255) {
    return { error: "fileName must be 255 characters or fewer" };
  }

  return {
    value: {
      signerName,
      signerEmail,
      signatureType: signatureType || "",
      signatureData,
      fileName,
    },
  };
}

function buildTrainingProviderSignatureRequestPayload(payload) {
  const email = normalizeEmail(payload.trainingProviderEmail || payload.email);
  const name = normalizeString(payload.trainingProviderName || payload.name);
  const subject =
    normalizeString(payload.subject) || "Please add your training provider signature";
  const message =
    normalizeString(payload.message) ||
    "I have completed my registration form and require your signature to finalise the process.";

  if (!validateEmail(email) || email.length > 160) {
    return { error: "trainingProviderEmail must be a valid email address" };
  }

  if (name.length > 120) {
    return { error: "trainingProviderName must be 120 characters or fewer" };
  }

  if (!subject || subject.length > 200) {
    return { error: "subject is required and must be 200 characters or fewer" };
  }

  if (!message || message.length > 2000) {
    return { error: "message is required and must be 2000 characters or fewer" };
  }

  return {
    value: {
      email,
      name,
      subject,
      message,
    },
  };
}

function parseOptionalDateTime(value, label) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return { value: null };
  }

  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return { error: `${label} must be a valid date` };
  }

  return { value: date };
}

function buildSessionPayload(payload, options = {}) {
  const { partial = false, fallbackLocation = "" } = options;

  const hasStartDateField =
    Object.prototype.hasOwnProperty.call(payload, "sessionStartDateTime") ||
    Object.prototype.hasOwnProperty.call(payload, "startDateTime") ||
    Object.prototype.hasOwnProperty.call(payload, "sessionDateTime");
  const hasEndDateField =
    Object.prototype.hasOwnProperty.call(payload, "sessionEndDateTime") ||
    Object.prototype.hasOwnProperty.call(payload, "endDateTime");
  const hasLocationField =
    Object.prototype.hasOwnProperty.call(payload, "sessionLocation") ||
    Object.prototype.hasOwnProperty.call(payload, "location");

  const startDateTimeResult = parseOptionalDateTime(
    payload.sessionStartDateTime || payload.startDateTime || payload.sessionDateTime,
    "Session start date"
  );
  if (startDateTimeResult.error) {
    return { error: startDateTimeResult.error };
  }

  const endDateTimeResult = parseOptionalDateTime(
    payload.sessionEndDateTime || payload.endDateTime,
    "Session end date"
  );
  if (endDateTimeResult.error) {
    return { error: endDateTimeResult.error };
  }

  if (
    startDateTimeResult.value &&
    endDateTimeResult.value &&
    endDateTimeResult.value.getTime() < startDateTimeResult.value.getTime()
  ) {
    return { error: "Session end date must be after the session start date" };
  }

  const sessionLocation = normalizeString(payload.sessionLocation || payload.location || fallbackLocation);
  if (sessionLocation.length > 150) {
    return { error: "Session location must be 150 characters or fewer" };
  }

  const session = {};

  if (!partial || hasStartDateField) {
    session.startDateTime = startDateTimeResult.value;
  }

  if (!partial || hasEndDateField) {
    session.endDateTime = endDateTimeResult.value;
  }

  if (!partial || hasLocationField) {
    session.location = sessionLocation;
  }

  return { value: session };
}

function normalizeCardNumber(value) {
  return normalizeString(value).replace(/\s+/g, "");
}

function detectCardBrand(cardNumber) {
  if (/^4/.test(cardNumber)) {
    return "Visa";
  }

  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) {
    return "Mastercard";
  }

  if (/^3[47]/.test(cardNumber)) {
    return "American Express";
  }

  if (/^6(?:011|5|4[4-9])/.test(cardNumber)) {
    return "Discover";
  }

  return "Card";
}

function parseExpiry(rawExpiry, rawMonth, rawYear) {
  let monthValue = normalizeString(rawMonth);
  let yearValue = normalizeString(rawYear);
  const expiry = normalizeString(rawExpiry);

  if (expiry) {
    const [monthPart, yearPart] = expiry.split("/");
    monthValue = normalizeString(monthPart);
    yearValue = normalizeString(yearPart);
  }

  if (!monthValue || !yearValue) {
    return { error: "Card expiry is required" };
  }

  const month = Number(monthValue);
  let year = Number(yearValue);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "Card expiry month must be between 01 and 12" };
  }

  if (!Number.isInteger(year)) {
    return { error: "Card expiry year is invalid" };
  }

  if (yearValue.length === 2) {
    year += 2000;
  }

  const expiryDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  if (Number.isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
    return { error: "Card has expired" };
  }

  return {
    value: {
      month,
      year,
    },
  };
}

function validatePaymentPayload(payload) {
  const cardPayload =
    payload && typeof payload.card === "object" && payload.card !== null ? payload.card : payload || {};

  const agreedToTerms = normalizeBoolean(payload.agreedToTerms, false);
  const cardNumber = normalizeCardNumber(cardPayload.number || payload.cardNumber);
  const cvc = normalizeString(cardPayload.cvc || payload.cvc);
  const expiryResult = parseExpiry(
    cardPayload.expiry || payload.expiry,
    cardPayload.expiryMonth || payload.expiryMonth,
    cardPayload.expiryYear || payload.expiryYear
  );

  if (!agreedToTerms) {
    return { error: "You must agree to the terms and privacy policy before payment" };
  }

  if (!/^\d{12,19}$/.test(cardNumber)) {
    return { error: "Card number must be between 12 and 19 digits" };
  }

  if (expiryResult.error) {
    return { error: expiryResult.error };
  }

  if (!/^\d{3,4}$/.test(cvc)) {
    return { error: "CVC must be 3 or 4 digits" };
  }

  return {
    value: {
      agreedToTerms,
      cardBrand: detectCardBrand(cardNumber),
      cardLast4: cardNumber.slice(-4),
      expiryMonth: expiryResult.value.month,
      expiryYear: expiryResult.value.year,
    },
  };
}

function createBookingNumber() {
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `BK-${dateStamp}-${randomSuffix}`;
}

function createTransactionId() {
  return `txn_${crypto.randomBytes(8).toString("hex")}`;
}

async function ensureUniqueBookingNumber() {
  let candidate = createBookingNumber();

  while (await Booking.exists({ bookingNumber: candidate })) {
    candidate = createBookingNumber();
  }

  return candidate;
}

async function findBookableCourse(payload) {
  const courseId = normalizeString(payload.courseId);
  const courseSlug = normalizeString(payload.courseSlug || payload.slug).toLowerCase();

  if (!courseId && !courseSlug) {
    return { error: "courseId or courseSlug is required" };
  }

  const filter = {
    isPublished: true,
    status: { $in: ["available", "upcoming"] },
  };

  if (courseId) {
    if (!mongoose.isValidObjectId(courseId)) {
      return { error: "Invalid course id" };
    }

    filter._id = courseId;
  } else {
    filter.slug = courseSlug;
  }

  const course = await Course.findOne(filter);

  if (!course) {
    return { status: 404, error: "Course not found" };
  }

  return { value: course };
}

function getRawRequestedAssessmentVariant(payload) {
  return normalizeString(
    payload?.assessmentVariant ||
      payload?.assessment_variant ||
      payload?.checklistVariant ||
      payload?.variant ||
      payload?.courseVariant ||
      payload?.assessmentDetails?.assessmentVariant ||
      payload?.assessmentDetails?.checklistVariant
  );
}

function resolveBookingAssessmentVariant(course, payload, registrationPayload = {}) {
  const rawRequestedVariant = getRawRequestedAssessmentVariant(payload);
  const requestedVariant = normalizeChecklistVariant(rawRequestedVariant);
  const courseVariant = inferChecklistVariantFromCourse(course);
  const explicitAnswerId = normalizeString(
    payload?.answerId ||
      payload?.selectedAnswerId ||
      payload?.optionId
  );
  const eligibilityAnswerId = normalizeString(
    payload?.eligibilityCheck?.nvqRegistrationDate ||
      registrationPayload?.eligibilityCheck?.nvqRegistrationDate
  );
  const selectedAnswerId = explicitAnswerId || eligibilityAnswerId;
  const selectedOption = findEligibilityOptionById(selectedAnswerId);
  const answerVariant = selectedOption?.leadsToVariant || "";

  if (rawRequestedVariant && !requestedVariant) {
    return {
      error: "assessmentVariant must be one of am2, am2e, or am2e-v1",
    };
  }

  if (explicitAnswerId && !selectedOption) {
    return {
      error: "Invalid answerId for nvq-registration-date",
    };
  }

  if (requestedVariant && answerVariant && requestedVariant !== answerVariant) {
    return {
      error: "assessmentVariant does not match the selected eligibility answer",
    };
  }

  if (
    requestedVariant &&
    !isAssessmentVariantPricingCourse(course) &&
    requestedVariant !== courseVariant.variant
  ) {
    return {
      error: "assessmentVariant can only be changed for am2-assessment-preparation",
    };
  }

  return {
    variant: answerVariant || requestedVariant || courseVariant.variant || "am2",
    source: answerVariant
      ? "eligibility-answer"
      : requestedVariant
        ? "request"
        : courseVariant.source || "course",
  };
}

function getBookingQueryForUser(id, userId) {
  return {
    _id: id,
    user: userId,
  };
}

function buildUserSummary(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  return {
    id: user._id || user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function formatRelativeTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffInSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (diffInSeconds < 60) {
    return `${diffInSeconds || 1} sec ago`;
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} min ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
}

function getInitial(value) {
  return (typeof value === "string" && value.trim() ? value.trim()[0] : "?").toUpperCase();
}

function getAvatarTone(seed) {
  const tones = ["green", "blue", "orange", "red", "cyan", "purple", "indigo", "teal"];
  const normalizedSeed = typeof seed === "string" ? seed : "";

  const toneIndex = normalizedSeed
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);

  return tones[toneIndex % tones.length];
}

function getAdminBookingLifecycleStatus(booking, now = new Date()) {
  const sessionStartDateTime = booking.session?.startDateTime ? new Date(booking.session.startDateTime) : null;

  if (booking.status === "cancelled" || booking.payment?.status === "refunded") {
    return {
      key: "cancelled",
      label: "Cancelled",
      tone: "danger",
    };
  }

  if (
    booking.status === "confirmed" &&
    sessionStartDateTime &&
    !Number.isNaN(sessionStartDateTime.getTime()) &&
    sessionStartDateTime.getTime() < now.getTime()
  ) {
    return {
      key: "completed",
      label: "Completed",
      tone: "success",
    };
  }

  if (booking.status === "confirmed" && booking.payment?.status === "paid") {
    return {
      key: "confirmed",
      label: "Confirmed",
      tone: "success",
    };
  }

  if (booking.payment?.status === "failed") {
    return {
      key: "payment_failed",
      label: "Payment Failed",
      tone: "warning",
    };
  }

  return {
    key: "in_progress",
    label: "In Progress",
    tone: "info",
  };
}

function buildVerificationStatus(isSigned) {
  return isSigned
    ? {
        key: "signed",
        label: "Signed",
        tone: "success",
      }
    : {
        key: "not_signed",
        label: "Not Signed",
        tone: "danger",
      };
}

function splitChecklistItems(content) {
  const normalizedContent = normalizeString(content);

  if (!normalizedContent) {
    return [];
  }

  const lineItems = normalizedContent
    .split(/\r?\n|•|;|\|/)
    .map((item) => normalizeString(item))
    .filter(Boolean);

  if (lineItems.length > 1) {
    return lineItems.slice(0, 8);
  }

  return normalizedContent
    .split(". ")
    .map((item) => normalizeString(item.replace(/\.$/, "")))
    .filter(Boolean)
    .slice(0, 8);
}

function buildFallbackChecklistSections(booking, course) {
  const courseTitle = course?.title || booking.courseSnapshot?.title || "Selected course";
  const qualification = course?.qualification || booking.courseSnapshot?.qualification || "";
  const sessionLocation = booking.session?.location || course?.location || booking.courseSnapshot?.location || "";
  const sessionLabel = formatDisplayDateTime(booking.session?.startDateTime);
  const trainingCenter = booking.personalDetails?.trainingCenter || "";

  return [
    {
      title: "Section A: Safe Isolation & Risk Assessment",
      rows: [
        `Carry out and document an assessment of risk for ${courseTitle}`,
        sessionLabel
          ? `Carry out safe isolation in the correct sequence for ${sessionLabel}`
          : "Carry out safe isolation in the correct sequence",
      ],
    },
    {
      title: "Section B: Safe Isolation & Risk Assessment",
      rows: [
        qualification ? `Interpretation of specifications and technical data for ${qualification}` : "Interpretation of specifications and technical data",
        "Selection of protective devices",
        "Install protective equipotential bonding",
        trainingCenter ? `Project timeline update for ${trainingCenter}` : "Project timeline update",
        "Team skill assessment",
      ],
    },
    {
      title: "Section C: Safe Isolation & Risk Assessment",
      rows: [
        "AM2 assessment preparation",
        "IoT device programming",
        sessionLocation ? `AI and machine learning for site operations at ${sessionLocation}` : "AI and machine learning",
        "Blockchain development",
        "Cybersecurity fundamentals",
      ],
    },
  ];
}

function buildChecklistAssessmentStatus(booking) {
  if (booking.status === "cancelled" || booking.payment?.status === "refunded") {
    return {
      key: "not_assessed",
      label: "Not Assessed",
      tone: "danger",
    };
  }

  return {
    key: "adequate",
    label: "Adequate",
    tone: "success",
  };
}

function buildChecklistSectionStatus(booking) {
  if (booking.status === "cancelled" || booking.payment?.status === "refunded") {
    return {
      key: "on_hold",
      label: "On Hold",
      tone: "warning",
    };
  }

  return {
    key: "completed",
    label: "Completed",
    tone: "success",
  };
}

function buildBookingChecklistSummary(booking, course) {
  const assessmentStatus = buildChecklistAssessmentStatus(booking);
  const sectionStatus = buildChecklistSectionStatus(booking);
  const sourceTitle =
    normalizeString(course?.sourceCourseName) ||
    normalizeString(course?.title) ||
    normalizeString(booking.courseSnapshot?.title) ||
    "Booking";

  const sourceSections =
    Array.isArray(course?.detailSections) && course.detailSections.length > 0
      ? course.detailSections.map((section) => ({
          title: section.title,
          rows: splitChecklistItems(section.content),
        }))
      : buildFallbackChecklistSections(booking, course);

  const sections = sourceSections
    .map((section, sectionIndex) => {
      const rows = (Array.isArray(section.rows) ? section.rows : [])
        .map((item) => normalizeString(item))
        .filter(Boolean)
        .slice(0, 8)
        .map((criterion, rowIndex) => ({
          id: `${booking._id}-checklist-${sectionIndex + 1}-${rowIndex + 1}`,
          no: rowIndex + 1,
          criterion,
          knowledge: assessmentStatus,
          experience: assessmentStatus,
        }));

      if (rows.length === 0) {
        return null;
      }

      return {
        id: `${booking._id}-checklist-section-${sectionIndex + 1}`,
        title: section.title || `Checklist Section ${sectionIndex + 1}`,
        status: sectionStatus,
        rows,
        summary: {
          totalItems: rows.length,
          completedItems: sectionStatus.key === "completed" ? rows.length : 0,
          pendingItems: sectionStatus.key === "completed" ? 0 : rows.length,
        },
      };
    })
    .filter(Boolean);

  return {
    title: `${sourceTitle} Checklist Summary`,
    isDerived: true,
    sections,
    summary: sections.reduce(
      (accumulator, section) => {
        accumulator.totalSections += 1;
        accumulator.totalItems += section.summary.totalItems;
        accumulator.completedItems += section.summary.completedItems;
        accumulator.pendingItems += section.summary.pendingItems;
        return accumulator;
      },
      {
        totalSections: 0,
        totalItems: 0,
        completedItems: 0,
        pendingItems: 0,
      }
    ),
    download: {
      label: "Download",
      available: false,
      url: null,
      reason: "Checklist exports are not implemented yet",
    },
  };
}

function buildUploadedDocumentItems(booking) {
  return getBookingDocumentsArray(booking).map((document, index) => {
    const uploadedDocument = mapUploadedBookingDocument(document, `document-${index + 1}`);
    const documentId = uploadedDocument.id || `document-${index + 1}`;
    const fileUrl = uploadedDocument.fileUrl || "";
    const label = uploadedDocument.label || uploadedDocument.fileName || "Uploaded document";

    return {
      id: `${booking._id}-document-${documentId}`,
      type: uploadedDocument.type || documentId,
      label,
      name: label,
      fileName: uploadedDocument.fileName,
      description: uploadedDocument.fileName
        ? `Uploaded file: ${uploadedDocument.fileName}`
        : "Uploaded through the booking document flow.",
      category: uploadedDocument.type || documentId,
      isDerived: false,
      available: Boolean(fileUrl),
      previewUrl: fileUrl || null,
      downloadUrl: fileUrl || null,
      fileUrl: fileUrl || null,
      mimeType: uploadedDocument.mimeType,
      uploadedAt: uploadedDocument.uploadedAt,
    };
  });
}

function buildAdminBookingDocumentsPayload(booking) {
  const documentItems = buildUploadedDocumentItems(booking);
  const signatureItems = buildSignatureDocumentItems(booking);
  const uploadedItems = [...documentItems, ...signatureItems];
  const requirements = buildDocumentRequirements(booking);
  const uploadedRequirementCount = requirements.filter((requirement) => requirement.uploaded).length;

  return {
    title: "Uploaded Documents",
    uploadApiUrl: `/api/bookings/${booking._id}/flow/documents/upload`,
    items: uploadedItems,
    uploadedItems,
    documentItems,
    signatureItems,
    signatures: buildBookingSignaturesPayload(booking),
    requirements,
    completion: {
      uploadedCount: uploadedRequirementCount,
      totalRequired: requirements.length,
      percentage: requirements.length
        ? Math.round((uploadedRequirementCount / requirements.length) * 100)
        : 0,
    },
  };
}

function getSignatureMimeType(value, fileName = "") {
  const normalizedValue = normalizeString(value);
  const dataUrlMatch = normalizedValue.match(/^data:([^;,]+)[;,]/i);

  if (dataUrlMatch) {
    return dataUrlMatch[1].toLowerCase();
  }

  const normalizedFileName = normalizeString(fileName).toLowerCase();

  if (normalizedFileName.endsWith(".jpg") || normalizedFileName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedFileName.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

function getRawSignatureData(signature = {}) {
  return normalizeString(
    signature.signatureData ||
      signature.signatureImageUrl ||
      signature.fileUrl ||
      signature.imageUrl ||
      signature.previewUrl ||
      signature.downloadUrl
  );
}

function normalizeSignatureImageUrl(value) {
  const signatureValue = normalizeString(value);

  if (!signatureValue) {
    return "";
  }

  const normalizedPath = signatureValue.replace(/\\/g, "/");

  if (/^uploads\//i.test(normalizedPath)) {
    return `/${normalizedPath}`;
  }

  return normalizedPath;
}

function isImageFilePath(value) {
  return /\.(jpe?g|png|webp|gif|svg)(?:[?#].*)?$/i.test(normalizeString(value));
}

function isRenderableSignatureImage(value) {
  const signatureValue = normalizeSignatureImageUrl(value);

  return /^(https?:\/\/|\/uploads\/|data:image\/)/i.test(signatureValue) || isImageFilePath(signatureValue);
}

function mapSignatureForClient(signature = {}) {
  const rawSignatureData = getRawSignatureData(signature);
  const signatureType = normalizeString(signature.signatureType).toLowerCase();
  const status = signature.status || "not_signed";
  const imageAvailable = Boolean(
    rawSignatureData &&
      signatureType !== "typed" &&
      isRenderableSignatureImage(rawSignatureData)
  );
  const signatureUrl = imageAvailable ? normalizeSignatureImageUrl(rawSignatureData) : null;

  return {
    status,
    signerName: signature.signerName || "",
    signerEmail: signature.signerEmail || "",
    signatureType: signature.signatureType || "",
    fileName: signature.fileName || "",
    requestedAt: signature.requestedAt || null,
    signedAt: signature.signedAt || null,
    rawSignatureData: imageAvailable ? rawSignatureData : null,
    signatureData: signatureUrl,
    url: signatureUrl,
    imageUrl: signatureUrl,
    signatureImageUrl: signatureUrl,
    previewUrl: signatureUrl || null,
    downloadUrl: signatureUrl || null,
    available: imageAvailable,
  };
}

function buildSignatureDocumentItem(booking, config) {
  const details = {
    ...mapSignatureForClient(config.signature || {}),
    status: config.status,
  };

  if (!details.available) {
    return null;
  }

  return {
    id: `${booking._id}-${config.id}-signature`,
    type: config.type,
    label: config.label,
    name: `${config.label} Signature`,
    fileName: details.fileName || `${config.type}.png`,
    description: `${config.label} signature submitted by ${details.signerName || "signer"}.`,
    category: "signature",
    signatureRole: config.id,
    isDerived: false,
    available: true,
    url: details.url || details.imageUrl,
    imageUrl: details.imageUrl,
    signatureImageUrl: details.signatureImageUrl,
    previewUrl: details.previewUrl,
    downloadUrl: details.downloadUrl,
    fileUrl: details.imageUrl || details.signatureData,
    mimeType: getSignatureMimeType(details.signatureData, details.fileName),
    uploadedAt: details.signedAt,
    signedAt: details.signedAt,
    signerName: details.signerName,
    signerEmail: details.signerEmail,
    signatureType: details.signatureType,
    signature: details,
  };
}

function buildSignatureDocumentItems(booking) {
  return [
    buildSignatureDocumentItem(booking, {
      id: "candidate",
      type: "candidate_signature",
      label: "Candidate",
      status: getCandidateSignatureStatus(booking),
      signature: booking.candidateSignature,
    }),
    buildSignatureDocumentItem(booking, {
      id: "training-provider",
      type: "training_provider_signature",
      label: "Training Provider",
      status: getTrainingProviderSignatureStatus(booking),
      signature: booking.trainingProviderSignature,
    }),
  ].filter(Boolean);
}

function buildBookingSignaturesPayload(booking) {
  const signatureItems = buildSignatureDocumentItems(booking);
  const signatureByRole = new Map(signatureItems.map((item) => [item.signatureRole, item]));
  const candidate = {
    ...mapSignatureForClient(booking.candidateSignature || {}),
    status: getCandidateSignatureStatus(booking),
  };
  const trainingProvider = {
    ...mapSignatureForClient(booking.trainingProviderSignature || {}),
    status: getTrainingProviderSignatureStatus(booking),
  };

  return {
    title: "Signatures",
    candidate: {
      ...candidate,
      document: signatureByRole.get("candidate") || null,
    },
    trainingProvider: {
      ...trainingProvider,
      document: signatureByRole.get("training-provider") || null,
    },
    items: [
      {
        id: "candidate",
        label: "Candidate",
        ...candidate,
        document: signatureByRole.get("candidate") || null,
      },
      {
        id: "training_provider",
        label: "Training Provider",
        ...trainingProvider,
        document: signatureByRole.get("training-provider") || null,
      },
    ],
  };
}

function buildBookingDocuments(booking) {
  const documentItems = buildUploadedDocumentItems(booking);
  const signatureItems = buildSignatureDocumentItems(booking);
  const uploadedItems = [...documentItems, ...signatureItems];

  return {
    title: "Uploaded Documents",
    isDerived: false,
    items: uploadedItems,
    documentItems,
    signatureItems,
    signatures: buildBookingSignaturesPayload(booking),
    downloadAll: {
      label: "Download all",
      available: false,
      url: null,
      reason: uploadedItems.length
        ? "Download all is not implemented yet. Open each uploaded document individually."
        : "No documents have been uploaded for this booking yet.",
    },
  };
}

function buildBookingVerification(booking) {
  const candidateSigned = getCandidateSignatureStatus(booking) === "signed";
  const providerSigned = getTrainingProviderSignatureStatus(booking) === "signed";
  const candidateSignature = {
    ...mapSignatureForClient(booking.candidateSignature || {}),
    status: getCandidateSignatureStatus(booking),
  };
  const trainingProviderSignature = {
    ...mapSignatureForClient(booking.trainingProviderSignature || {}),
    status: getTrainingProviderSignatureStatus(booking),
  };

  return {
    title: "Signatures & Verification",
    items: [
      {
        id: "candidate",
        label: "Candidate",
        status: buildVerificationStatus(candidateSigned),
        supportingText: candidateSigned
          ? "The candidate signature has been submitted."
          : "The candidate has not completed a signed submission yet.",
        signature: candidateSignature,
        url: candidateSignature.url || candidateSignature.imageUrl,
        imageUrl: candidateSignature.imageUrl,
        signatureImageUrl: candidateSignature.signatureImageUrl,
        previewUrl: candidateSignature.previewUrl,
        action: {
          label: "View",
          type: "view_candidate",
          url: `/admin/candidates/${booking._id}`,
          apiUrl: `/api/admin/candidates/${booking._id}`,
        },
      },
      {
        id: "training_provider",
        label: "Training Provider",
        status: buildVerificationStatus(providerSigned),
        supportingText: providerSigned
          ? "Training provider verification is completed."
          : "Training provider verification is still pending.",
        signature: trainingProviderSignature,
        url: trainingProviderSignature.url || trainingProviderSignature.imageUrl,
        imageUrl: trainingProviderSignature.imageUrl,
        signatureImageUrl: trainingProviderSignature.signatureImageUrl,
        previewUrl: trainingProviderSignature.previewUrl,
        action: {
          label: "View",
          type: "view_booking",
          url: `/admin/bookings/${booking._id}`,
          apiUrl: `/api/admin/bookings/${booking._id}`,
        },
      },
    ],
  };
}

function buildBookingReviewDecision(booking) {
  const candidateEmail = booking.personalDetails?.email || booking.user?.email || "";
  const rejectPayload =
    booking.payment?.status === "paid"
      ? {
          status: "cancelled",
          paymentStatus: "refunded",
        }
      : {
          status: "cancelled",
        };

  return {
    title: "Review Decision",
    currentStatus: getAdminBookingLifecycleStatus(booking),
    actions: {
      sendReminder: {
        label: "Send Reminder",
        tone: "secondary",
        type: "email",
        enabled: Boolean(candidateEmail) && booking.status === "pending_payment",
        url: candidateEmail
          ? `mailto:${candidateEmail}?subject=${encodeURIComponent(`Booking reminder: ${booking.bookingNumber}`)}`
          : null,
      },
      rejectCandidate: {
        label: "Reject Candidate",
        tone: "danger",
        method: "PATCH",
        enabled: booking.status !== "cancelled",
        url: `/api/admin/bookings/${booking._id}`,
        payload: rejectPayload,
      },
    },
  };
}

function buildAdminBookingProfile(booking) {
  const candidateName = booking.personalDetails?.fullName || booking.user?.name || "Unknown Candidate";
  const candidateEmail = booking.personalDetails?.email || booking.user?.email || "";
  const candidateId = String(booking.user?._id || booking._id || "")
    .slice(-6)
    .toUpperCase();
  const dateOfBirth = formatDateOnly(booking.personalDetails?.dateOfBirth);
  const dateOfBirthLabel = formatDisplayDateShort(booking.personalDetails?.dateOfBirth);
  const niNumber = booking.personalDetails?.niNumber || "";

  return {
    title: "Candidate Profile",
    initial: getInitial(candidateName),
    avatarTone: getAvatarTone(candidateName || candidateEmail),
    name: candidateName,
    bookingNumber: booking.bookingNumber,
    candidateNumber: candidateId,
    submittedAt: booking.createdAt,
    submittedAtLabel: formatDisplayDateTime(booking.createdAt),
    submittedRelative: formatRelativeTime(booking.createdAt),
    lifecycleStatus: getAdminBookingLifecycleStatus(booking),
    email: candidateEmail,
    phoneNumber: booking.personalDetails?.phoneNumber || "",
    dateOfBirth,
    dateOfBirthLabel,
    dob: dateOfBirthLabel,
    niNumber,
    nationalInsuranceNumber: niNumber,
    address: booking.personalDetails?.address || "",
    city: booking.personalDetails?.city || "",
    postcode: booking.personalDetails?.postcode || "",
    trainingCenter: booking.personalDetails?.trainingCenter || "",
  };
}

function getBookingTab(booking, now = new Date()) {
  if (booking.status === "cancelled" || booking.payment?.status === "refunded") {
    return "cancelled";
  }

  const sessionStartDateTime = booking.session?.startDateTime ? new Date(booking.session.startDateTime) : null;

  if (
    booking.status === "confirmed" &&
    sessionStartDateTime &&
    !Number.isNaN(sessionStartDateTime.getTime()) &&
    sessionStartDateTime.getTime() < now.getTime()
  ) {
    return "past";
  }

  return "upcoming";
}

function getBookingStatusBadge(booking, tab) {
  if (tab === "cancelled") {
    return {
      label: "Cancelled",
      tone: "danger",
    };
  }

  if (tab === "past") {
    return {
      label: "Completed",
      tone: "info",
    };
  }

  if (booking.status === "confirmed") {
    return {
      label: "Confirmed",
      tone: "success",
    };
  }

  if (booking.payment?.status === "failed") {
    return {
      label: "Payment Failed",
      tone: "warning",
    };
  }

  return {
    label: "Pending Payment",
    tone: "warning",
  };
}

function buildBookingTabFilter(tab, now = new Date()) {
  switch (tab) {
    case "cancelled":
      return {
        status: "cancelled",
      };
    case "past":
      return {
        status: "confirmed",
        "session.startDateTime": { $lt: now },
      };
    case "upcoming":
      return {
        $or: [
          {
            status: "pending_payment",
          },
          {
            status: "confirmed",
            $or: [{ "session.startDateTime": { $gte: now } }, { "session.startDateTime": null }],
          },
        ],
      };
    default:
      return {};
  }
}

function getBookingSort(tab) {
  switch (tab) {
    case "past":
      return { "session.startDateTime": -1, confirmedAt: -1, createdAt: -1 };
    case "cancelled":
      return { cancelledAt: -1, updatedAt: -1, createdAt: -1 };
    case "upcoming":
    default:
      return { "session.startDateTime": 1, createdAt: -1 };
  }
}

function buildBookingEmptyState(tab) {
  switch (tab) {
    case "past":
      return {
        title: "No Past Courses.",
        description: "Completed bookings will appear here once your training date has passed.",
        cta: null,
      };
    case "cancelled":
      return {
        title: "No Cancelled Courses.",
        description: "Cancelled bookings will appear here when a booking is cancelled.",
        cta: null,
      };
    case "upcoming":
    default:
      return {
        title: "No Upcoming Courses.",
        description: "Book your next training to see it listed here.",
        cta: {
          label: "Browse Courses",
          url: "/courses",
        },
      };
  }
}

function hasDashboardPersonalDetails(booking) {
  const personalDetails = booking?.personalDetails || {};

  return Boolean(
    normalizeString(personalDetails.fullName) &&
      normalizeString(personalDetails.email) &&
      normalizeString(personalDetails.phoneNumber) &&
      normalizeString(personalDetails.address) &&
      normalizeString(personalDetails.trainingCenter) &&
      normalizeString(personalDetails.city) &&
      normalizeString(personalDetails.postcode) &&
      personalDetails.dateOfBirth
  );
}

function hasDashboardSessionDetails(booking) {
  const session = booking?.session || {};
  return Boolean(session.startDateTime || normalizeString(session.location) || normalizeString(booking?.courseSnapshot?.schedule));
}

function buildDashboardReadinessTitle(booking, course) {
  const sourceCourseName = normalizeString(course?.sourceCourseName);

  if (sourceCourseName) {
    return `${sourceCourseName} Readiness Progress`;
  }

  const qualification = normalizeString(course?.qualification || booking?.courseSnapshot?.qualification);
  if (qualification && /\bam2\b/i.test(qualification)) {
    return "AM2 Readiness Progress";
  }

  const courseTitle = normalizeString(course?.title || booking?.courseSnapshot?.title);
  if (courseTitle && /\bam2\b/i.test(courseTitle)) {
    return "AM2 Readiness Progress";
  }

  return courseTitle ? `${courseTitle} Readiness Progress` : "Course Readiness Progress";
}

function buildDashboardProgressStatus(booking, percentage) {
  if (booking.payment?.status === "failed") {
    return {
      key: "action_required",
      label: "Action Required",
      tone: "warning",
    };
  }

  if (percentage >= 100) {
    return {
      key: "ready",
      label: "Ready",
      tone: "success",
    };
  }

  return {
    key: "in_progress",
    label: "In Progress",
    tone: "info",
  };
}

function buildUserDashboardProgress(booking, course) {
  const hasPersonalDetails = hasDashboardPersonalDetails(booking);
  const hasSessionDetails = hasDashboardSessionDetails(booking);
  const hasSignedTerms = Boolean(booking.payment?.agreedToTerms);
  const hasPaid = booking.payment?.status === "paid";
  const isConfirmed = booking.status === "confirmed";

  let completedWeight = 0;

  if (hasPersonalDetails) {
    completedWeight += 20;
  }

  if (hasSessionDetails) {
    completedWeight += 25;
  }

  if (hasSignedTerms) {
    completedWeight += 20;
  }

  if (hasPaid) {
    completedWeight += 20;
  }

  if (isConfirmed) {
    completedWeight += 15;
  }

  const percentage = Math.max(0, Math.min(100, completedWeight));
  const status = buildDashboardProgressStatus(booking, percentage);

  return {
    title: buildDashboardReadinessTitle(booking, course),
    trackLabel: "Self-Assessment Checklist",
    percentage,
    percentageLabel: `${percentage}%`,
    status,
    description:
      percentage >= 100
        ? "All prerequisite booking steps are complete."
        : "Complete all sections to proceed",
    milestones: {
      personalDetails: hasPersonalDetails,
      sessionDetails: hasSessionDetails,
      signedTerms: hasSignedTerms,
      payment: hasPaid,
      confirmation: isConfirmed,
    },
  };
}

function buildDashboardDocumentsCard(booking) {
  const personalDetails = booking?.personalDetails || {};
  let uploadedCount = 0;

  if (normalizeString(personalDetails.fullName) && normalizeString(personalDetails.email)) {
    uploadedCount += 1;
  }

  if (
    normalizeString(personalDetails.address) &&
    normalizeString(personalDetails.trainingCenter) &&
    normalizeString(personalDetails.postcode)
  ) {
    uploadedCount += 1;
  }

  return {
    id: "documents",
    label: "Documents",
    summary: `${uploadedCount}/2 uploaded`,
    description:
      uploadedCount === 2
        ? "Required booking records are ready for review."
        : "Complete your booking records to continue.",
    status:
      uploadedCount === 2
        ? {
            key: "uploaded",
            label: "Uploaded",
            tone: "success",
          }
        : {
            key: "pending",
            label: "Pending",
            tone: "warning",
          },
    action: {
      label: "View",
      url: `/bookings/${booking._id}`,
      apiUrl: `/api/bookings/${booking._id}`,
    },
  };
}

function buildDashboardSignaturesCard(booking) {
  const hasSignedTerms = Boolean(booking.payment?.agreedToTerms);
  const isApproved = hasSignedTerms && booking.status === "confirmed" && booking.payment?.status === "paid";

  let summary = "Pending approval";
  let description = "Complete the remaining booking steps to finalise signatures.";
  let status = {
    key: "pending_approval",
    label: "Pending Approval",
    tone: "warning",
  };

  if (booking.payment?.status === "failed") {
    summary = "Action required";
    description = booking.payment.failureReason || "Payment needs attention before signatures can be approved.";
    status = {
      key: "action_required",
      label: "Action Required",
      tone: "warning",
    };
  } else if (isApproved) {
    summary = "Approved";
    description = "Candidate signatures and booking approval are complete.";
    status = {
      key: "approved",
      label: "Approved",
      tone: "success",
    };
  } else if (hasSignedTerms) {
    description = "Your submission is signed and waiting for final approval.";
  }

  return {
    id: "signatures",
    label: "Signatures",
    summary,
    description,
    status,
    action: {
      label: "View",
      url: `/bookings/${booking._id}`,
      apiUrl: `/api/bookings/${booking._id}`,
    },
  };
}

function mapUserDashboardBooking(booking) {
  const course = booking.course && typeof booking.course === "object" ? booking.course : null;
  const progress = buildUserDashboardProgress(booking, course);
  const summary = mapBookingSummary(booking);

  return {
    id: summary.id,
    bookingNumber: summary.bookingNumber,
    status: summary.status,
    paymentStatus: summary.paymentStatus,
    statusBadge: progress.status,
    course: summary.course,
    session: summary.session,
    progress,
    cards: {
      documents: buildDashboardDocumentsCard(booking),
      signatures: buildDashboardSignaturesCard(booking),
    },
    action: {
      label: booking.payment?.status === "paid" ? "View Booking" : "Continue",
      url: `/bookings/${booking._id}`,
      apiUrl: `/api/bookings/${booking._id}`,
    },
  };
}

function mapUpcomingDashboardBooking(booking) {
  const summary = mapBookingSummary(booking);

  return {
    id: summary.id,
    bookingNumber: summary.bookingNumber,
    statusBadge: summary.statusBadge,
    course: summary.course,
    session: summary.session,
    action: {
      label: "View Booking",
      url: `/bookings/${booking._id}`,
      apiUrl: `/api/bookings/${booking._id}`,
    },
  };
}

function buildUserDashboardActivityFeed(user, bookings) {
  const items = [];

  if (user?.createdAt) {
    items.push({
      id: `user-${user.id || user._id}-created`,
      type: "user_registration",
      title: "New user registration",
      description: user.name || user.email || "Account created",
      occurredAt: user.createdAt,
      relativeTime: formatRelativeTime(user.createdAt),
      tone: "info",
    });
  }

  bookings.forEach((booking) => {
    items.push({
      id: `booking-${booking._id}-created`,
      type: "booking_created",
      title: "Course booking submitted",
      description: booking.courseSnapshot?.title || booking.bookingNumber,
      occurredAt: booking.createdAt,
      relativeTime: formatRelativeTime(booking.createdAt),
      tone: "info",
    });

    if (booking.payment?.status === "paid" && booking.payment?.paidAt) {
      items.push({
        id: `booking-${booking._id}-payment`,
        type: "payment_received",
        title: "Payment received",
        description: `Invoice #${booking.bookingNumber}`,
        occurredAt: booking.payment.paidAt,
        relativeTime: formatRelativeTime(booking.payment.paidAt),
        tone: "success",
      });
    }

    if (booking.status === "confirmed" && booking.confirmedAt) {
      items.push({
        id: `booking-${booking._id}-confirmed`,
        type: "booking_confirmed",
        title: "Booking confirmed",
        description:
          booking.session?.startDateTime
            ? `Session scheduled for ${formatDisplayDateTime(booking.session.startDateTime)}`
            : booking.courseSnapshot?.title || booking.bookingNumber,
        occurredAt: booking.confirmedAt,
        relativeTime: formatRelativeTime(booking.confirmedAt),
        tone: "success",
      });
    }

    if (booking.payment?.status === "failed") {
      items.push({
        id: `booking-${booking._id}-failed`,
        type: "payment_failed",
        title: "Payment failed",
        description: booking.payment.failureReason || `Invoice #${booking.bookingNumber}`,
        occurredAt: booking.updatedAt || booking.createdAt,
        relativeTime: formatRelativeTime(booking.updatedAt || booking.createdAt),
        tone: "warning",
      });
    }

    if (booking.status === "cancelled" && booking.cancelledAt) {
      items.push({
        id: `booking-${booking._id}-cancelled`,
        type: "booking_cancelled",
        title: "Booking cancelled",
        description: booking.courseSnapshot?.title || booking.bookingNumber,
        occurredAt: booking.cancelledAt,
        relativeTime: formatRelativeTime(booking.cancelledAt),
        tone: "danger",
      });
    }
  });

  return items
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 8);
}

function buildUserDashboardWelcome(user, runningBooking, upcomingBooking) {
  const focusLabel = normalizeString(
    runningBooking?.course?.sourceCourseName ||
      runningBooking?.course?.title ||
      runningBooking?.course?.qualification ||
      upcomingBooking?.course?.title ||
      upcomingBooking?.course?.qualification
  );

  const normalizedFocus = /\bam2\b/i.test(focusLabel) ? "AM2" : focusLabel;

  return {
    title: `Welcome back, ${user.name} !`,
    subtitle: normalizedFocus
      ? `Track your ${normalizedFocus} readiness progress, manage your documents, and book your final assessment.`
      : "Track your readiness progress, manage your documents, and book your final assessment.",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      initial: getInitial(user.name || user.email),
      avatarTone: getAvatarTone(user.name || user.email),
    },
  };
}

function buildCheckoutSteps(activeStepId) {
  const steps = [
    { id: "details", label: "Details" },
    { id: "payment", label: "Payment" },
    { id: "confirm", label: "Confirm" },
  ];

  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === activeStepId)
  );

  return steps.map((step, index) => ({
    ...step,
    status: index < activeIndex ? "completed" : index === activeIndex ? "current" : "upcoming",
  }));
}

const BOOKING_FLOW_STEPS = [
  { id: "documents", label: "Documents" },
  { id: "checklist", label: "Checklist" },
  { id: "signatures", label: "Signatures" },
  { id: "submit", label: "Submit" },
  { id: "review", label: "Review" },
  { id: "payment", label: "Payment" },
  { id: "confirmed", label: "Confirmed" },
];

function buildBookingFlowSteps(activeStepId) {
  const activeIndex = Math.max(
    0,
    BOOKING_FLOW_STEPS.findIndex((step) => step.id === activeStepId)
  );

  return BOOKING_FLOW_STEPS.map((step, index) => ({
    ...step,
    status: index < activeIndex ? "completed" : index === activeIndex ? "current" : "upcoming",
  }));
}

function normalizeDocumentTypeKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getBookingDocumentsArray(booking) {
  return Array.isArray(booking?.documents) ? booking.documents : [];
}

function mapUploadedBookingDocument(document, fallbackId) {
  if (!document) {
    return null;
  }

  const fileUrl = normalizeString(document.fileUrl);

  return {
    id: normalizeString(document.type) || fallbackId || "",
    type: normalizeString(document.type),
    label: normalizeString(document.label),
    fileName: normalizeString(document.fileName),
    fileUrl,
    previewUrl: fileUrl || null,
    downloadUrl: fileUrl || null,
    mimeType: normalizeString(document.mimeType),
    uploadedAt: document.uploadedAt || null,
  };
}

function findBookingDocumentByType(booking, ...documentTypes) {
  const typeKeys = documentTypes
    .map((documentType) => normalizeDocumentTypeKey(documentType))
    .filter(Boolean);

  if (typeKeys.length === 0) {
    return null;
  }

  return (
    getBookingDocumentsArray(booking).find((document) =>
      typeKeys.includes(normalizeDocumentTypeKey(document?.type))
    ) || null
  );
}

function buildDocumentUploadAction(booking, requirement, uploadedDoc) {
  return {
    label: uploadedDoc ? "Replace" : "Upload",
    method: "POST",
    apiUrl: `/api/bookings/${booking._id}/flow/documents/upload`,
    contentType: "multipart/form-data",
    fields: [
      {
        id: "file",
        aliases: ["document", "upload", "certificate", "supportingDocument"],
        label: "Document File",
        type: "file",
        required: true,
        acceptedFileTypes: requirement.acceptedFileTypes || ["pdf", "jpg", "jpeg", "png", "webp"],
      },
      {
        id: "documentType",
        label: "Document Type",
        type: "text",
        required: true,
        value: requirement.id,
      },
      {
        id: "documentLabel",
        label: "Document Label",
        type: "text",
        required: false,
        value: requirement.title,
      },
    ],
  };
}

function buildDocumentRequirements(booking) {
  const variant = getChecklistVariantForBooking(booking);

  if (variant === "am2e" || variant === "am2e-v1") {
    const requirements = buildAm2eVariantDocumentRequirements(variant);
    return requirements.map((req) => {
      const uploadedDoc = findBookingDocumentByType(booking, req.id);
      return {
        id: req.id,
        title: req.title,
        description: req.description,
        acceptedFileTypes: req.acceptedFileTypes || ["pdf", "jpg", "jpeg", "png", "webp"],
        required: true,
        uploaded: Boolean(uploadedDoc),
        document: mapUploadedBookingDocument(uploadedDoc, req.id),
        action: buildDocumentUploadAction(booking, req, uploadedDoc),
      };
    });
  }

  const requirement = {
    id: "full_certificate",
    title: "Learner History Report or Walled Garden Report (City & Guilds)",
    description: "Requirements from your provider",
    acceptedFileTypes: ["pdf", "jpg", "jpeg", "png", "webp"],
  };
  const uploadedCertificate = findBookingDocumentByType(
    booking,
    requirement.id,
    "full-certificate",
    "full certificate"
  );

  return [
    {
      ...requirement,
      required: true,
      uploaded: Boolean(uploadedCertificate),
      document: mapUploadedBookingDocument(uploadedCertificate, requirement.id),
      action: buildDocumentUploadAction(booking, requirement, uploadedCertificate),
    },
  ];
}

function getRequestedDocumentType(body = {}) {
  return normalizeString(
    body.documentType ||
      body.requirementId ||
      body.documentId ||
      body.type ||
      body.document_type
  );
}

function resolveDocumentRequirementForUpload(booking, requestedDocumentType) {
  const requirements = buildDocumentRequirements(booking);
  const requestedTypeKey = normalizeDocumentTypeKey(requestedDocumentType);

  if (!requestedTypeKey && requirements.length === 1) {
    return {
      requirement: requirements[0],
      requirements,
    };
  }

  if (!requestedTypeKey) {
    return {
      error: `documentType is required. Use one of: ${requirements
        .map((requirement) => requirement.id)
        .join(", ")}`,
      status: 400,
      requirements,
    };
  }

  const requirement = requirements.find((item) => {
    const acceptedKeys = [
      item.id,
      item.title,
      item.document?.id,
      item.document?.type,
    ].map((value) => normalizeDocumentTypeKey(value));

    return acceptedKeys.includes(requestedTypeKey);
  });

  if (!requirement) {
    return {
      error: `Invalid documentType. Use one of: ${requirements
        .map((item) => item.id)
        .join(", ")}`,
      status: 400,
      requirements,
    };
  }

  return {
    requirement,
    requirements,
  };
}

function getChecklistVariantMetadata(variant = "am2") {
  if (variant === "am2e") {
    return {
      variant: "am2e",
      templateId: "net-am2e-full-candidate-checklist",
      title: "AM2E Full Checklist",
      subtitle: "Readiness for Assessment: Candidate Self-Assessment Checklist",
      description: "Complete your AM2E full checklist.",
    };
  }

  if (variant === "am2e-v1") {
    return {
      variant: "am2e-v1",
      templateId: "am2e-v1-checklist",
      title: "AM2E v1 Full Checklist",
      subtitle: "Readiness for Assessment: Candidate Self-Assessment Checklist",
      description: "Complete your AM2E v1 full checklist.",
    };
  }

  return {
    variant: "am2",
    templateId: "am2-checklist",
    title: "AM2 Checklist",
    subtitle: "Readiness for Assessment: Candidate Self-Assessment Checklist",
    description: "Complete your AM2 checklist.",
  };
}

function buildAm2ChecklistTemplates() {
  return [
    {
      id: "section-a1",
      key: "A1",
      label: "Section A1",
      title: "Section A1: Safe Isolation and Risk Assessment (45 mins)",
      duration: "45 mins",
      summary:
        "To demonstrate occupational competence candidates will need to:",
      items: [
        "Carry out and document an assessment of risk",
        "Carry out safe isolation in the correct sequence",
      ],
    },
    {
      id: "section-a2-a5",
      key: "A2-A5",
      label: "Sections A2-A5",
      title: "Sections A2-A5: Composite Installation (3.5 hours)",
      duration: "3.5 hours",
      summary:
        "This section or areas where candidates will need to demonstrate occupational competence in accordance with statutory and non-statutory regulations and approved industry working practices.",
      items: [
        "Carry out and document an assessment of risk",
        "Carry out safe isolation in the correct sequence",
        "Select and use tools, equipment and materials safely",
        "Interpret technical information and job instructions",
        "Install containment in accordance with specification",
        "Install cables and conductors to specification",
        "Install accessories and equipment correctly",
        "Terminate conductors using approved methods",
        "Identify and rectify non-compliances during installation",
        "Apply protective bonding requirements",
        "Maintain safe working practices throughout the task",
        "Use environmentally responsible working practices",
        "Inspect completed installation work",
        "Test continuity using approved methods",
        "Test insulation resistance using approved methods",
        "Record results accurately on the correct documentation",
        "Confirm polarity and circuit arrangement",
        "Demonstrate effective housekeeping throughout the task",
        "Complete the task within the allocated time",
      ],
    },
    {
      id: "section-b",
      key: "B",
      label: "Section B",
      title: "Section B: Inspection, Testing and Certification (3.5 hours)",
      duration: "3.5 hours",
      summary:
        "In this area candidates will be expected to follow practices and procedures that take into account electrically sensitive equipment.",
      items: [
        "Prepare inspection and testing instruments",
        "Verify continuity of protective conductors",
        "Verify continuity of ring final circuit conductors",
        "Verify insulation resistance",
        "Verify polarity",
        "Measure earth electrode resistance if applicable",
        "Measure earth fault loop impedance",
        "Test RCD operating times",
        "Carry out functional testing",
        "Interpret test results",
        "Identify unsatisfactory results",
        "Record observations accurately",
        "Complete certification details",
        "Confirm the installation is safe for energisation",
      ],
    },
    {
      id: "section-c",
      key: "C",
      label: "Section C",
      title: "Section C: Safe Isolation of Circuits (30 mins)",
      duration: "30 mins",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        "Identify the correct point of isolation",
        "Prove the voltage indicator before and after testing",
        "Secure isolation and display warning notices",
      ],
    },
    {
      id: "section-d",
      key: "D",
      label: "Section D",
      title: "Section D: Fault Diagnosis and Rectification (2 hours)",
      duration: "2 hours",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        "Interpret the fault information provided",
        "Follow safe isolation before investigation",
        "Carry out logical fault-finding procedures",
        "Rectify the identified fault correctly",
        "Confirm the installation operates safely after rectification",
      ],
    },
    {
      id: "section-e",
      key: "E",
      label: "Section E",
      title: "Section E: Assessment of Applied Knowledge (1 hour)",
      duration: "1 hour",
      summary:
        "This assessment will test for one hour and be in the form of a computerised multiple-choice test. Candidates will be expected to answer 30 questions and will be assessed on their application of knowledge associated with:",
      items: [
        "Health and safety requirements",
        "Electrical principles and regulations",
        "Installation practices and procedures",
        "Inspection, testing and certification knowledge",
      ],
    },
  ];
}

function buildAm2eFullChecklistTemplates() {
  return [
    {
      id: "am2e-section-a1",
      key: "A1",
      label: "Section A1",
      title: "Section A1: Safe Isolation and Risk Assessment (45 mins)",
      duration: "45 mins",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2e-a1-1",
          text: "Carry out and document an assessment of risk",
        },
        {
          id: "am2e-a1-2",
          text: "Carry out safe isolation in the correct sequence",
        },
      ],
    },
    {
      id: "am2e-section-a2-a6",
      key: "A2-A6",
      label: "Sections A2-A6",
      title: "Sections A2-A6: Composite Installation (10 hours)",
      duration: "10 hours",
      summary:
        "This section has areas where candidates will need to demonstrate occupational competence in accordance with statutory and non-statutory regulations and approved industry working practices.",
      items: [
        {
          id: "am2e-a2-1",
          text: "Interpretation of specifications and technical data",
        },
        {
          id: "am2e-a2-2",
          text: "Selection of protective devices",
        },
        {
          id: "am2e-a2-3",
          text: "Install protective equipotential bonding",
        },
        {
          id: "am2e-a2-4",
          text: "Install and terminate PVC singles cable",
        },
        {
          id: "am2e-a2-5",
          text: "Install and terminate PVC/PVC multi-core & cpc cable",
        },
        {
          id: "am2e-a2-6",
          text: "Install and terminate SY multi-flex cable",
        },
        {
          id: "am2e-a2-7",
          text: "Install and terminate heat-resistant flex",
        },
        {
          id: "am2e-a2-8",
          text: "Install and terminate XLPE SWA",
        },
        {
          id: "am2e-a2-9",
          text: "Install and terminate data-cable",
        },
        {
          id: "am2e-a2-10",
          text: "Install and terminate FP200 type cable",
        },
        {
          id: "am2e-a2-11",
          text: "Forming and install 20mm metal conduit",
        },
        {
          id: "am2e-a2-12",
          text: "Forming and installing 20mm PVC conduit",
        },
        {
          id: "am2e-a2-13",
          text: "Install protective devices in a TP&N distribution board",
        },
        {
          id: "am2e-a2-14",
          text: "Install a two-way and intermediate lighting circuit in PVC/PVC multi-core cable",
        },
        {
          id: "am2e-a2-15",
          text: "Install a BS 1363 13A socket outlet ring circuit in PVC singles cable",
        },
        {
          id: "am2e-a2-16",
          text: "Install a carbon monoxide detector safety service circuit in FP200 type cable",
        },
        {
          id: "am2e-a2-17",
          text: "Install data outlets circuit in Cat. 5 cable",
        },
        {
          id: "am2e-a2-18",
          text: "Install a BS EN 60309 16A T P & N socket outlet in XLPE SWA cable",
        },
        {
          id: "am2e-a2-19",
          text: "Install protective equipotential bonding to gas and water services",
        },
        {
          id: "am2e-a2-20",
          text: "Connect a 3-phase direct on line motor circuit in SY cable",
        },
        {
          id: "am2e-a2-21",
          text: "Install an S Plan central heating and hot water system with a solar thermal sustainable energy element utilising heat resistant flexible cable and PVC singles cable",
        },
      ],
    },
    {
      id: "am2e-section-b",
      key: "B",
      label: "Section B",
      title: "Section B: Inspection, Testing and Certification (3.5 hours)",
      duration: "3.5 hours",
      summary:
        "In this area candidates will be expected to follow practices and procedures that take into account electrically sensitive equipment. To demonstrate occupational competence, candidates will be expected to:",
      items: [
        {
          id: "am2e-b-1",
          text: "Work according to best practice as required by Health and Safety legislation",
        },
        {
          id: "am2e-b-2",
          text: "Ensure the installation is correctly isolated before commencing the inspection and test activity",
        },
        {
          id: "am2e-b-3",
          text: "Carry out a visual inspection of the installation in accordance with BS 7671 and IET Guidance Note 3",
        },
        {
          id: "am2e-b-4",
          text: "Continuity of protective conductors",
        },
        {
          id: "am2e-b-5",
          text: "Continuity of ring final circuit conductors",
        },
        {
          id: "am2e-b-6",
          text: "Insulation resistance",
        },
        {
          id: "am2e-b-7",
          text: "Polarity",
        },
        {
          id: "am2e-b-8",
          text: "Earth fault-loop impedance (EFLI)",
        },
        {
          id: "am2e-b-9",
          text: "Prospective fault current (PFC)",
        },
        {
          id: "am2e-b-10",
          text: "Check for phase sequence and phase rotation",
        },
        {
          id: "am2e-b-11",
          text: "Functional testing",
        },
        {
          id: "am2e-b-12",
          text: "Verify that the test results obtained conform to the values required by BS 7671 and IET Guidance Note 3",
        },
        {
          id: "am2e-b-13",
          text: "Complete an electrical installation certificate, schedule of inspections and schedule of test results using the model forms as illustrated in Appendix 6 of BS 7671",
        },
      ],
    },
    {
      id: "am2e-section-c",
      key: "C",
      label: "Section C",
      title: "Section C: Safe Isolation of Circuits (30 mins)",
      duration: "30 mins",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2e-c-1",
          text: "Carry out safe isolation in the correct sequence on a single-phase circuit",
        },
        {
          id: "am2e-c-2",
          text: "Carry out safe isolation in the correct sequence on a three-phase circuit",
        },
        {
          id: "am2e-c-3",
          text: "Carry out safe isolation in the correct sequence on a three-phase installation",
        },
      ],
    },
    {
      id: "am2e-section-d",
      key: "D",
      label: "Section D",
      title: "Section D: Fault Diagnosis and Rectification (2 hours)",
      duration: "2 hours",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2e-d-1",
          text: "Work according to best practice as required by Health and Safety legislation",
        },
        {
          id: "am2e-d-2",
          text: "Correctly identify and use tools, equipment and test instruments that are fit for purpose",
        },
        {
          id: "am2e-d-3",
          text: "Carry out checks and preparations that must be completed prior to undertaking fault diagnosis",
        },
        {
          id: "am2e-d-4",
          text: "Identify faults from 'fault symptom' information given by the assessor",
        },
        {
          id: "am2e-d-5",
          text: "State and record how the identified faults can be rectified",
        },
      ],
    },
    {
      id: "am2e-section-e",
      key: "E",
      label: "Section E",
      title: "Section E: Assessment of Applied Knowledge (1 hour)",
      duration: "1 hour",
      summary:
        "This assessment will last for one hour and be in the form of a computerised multiple-choice test. Candidates will be expected to answer 30 questions and will be assessed on their application of knowledge associated with:",
      items: [
        {
          id: "am2e-e-1",
          text: "Health and Safety",
        },
        {
          id: "am2e-e-2",
          text: "BS 7671: Requirements for Electrical Installations",
        },
        {
          id: "am2e-e-3",
          text: "Building Regulations",
        },
        {
          id: "am2e-e-4",
          text: "Inspection, Testing and Fault Finding",
        },
      ],
    },
  ];
}

function buildAm2eV1ChecklistTemplates() {
  return [
    {
      id: "am2ev1-section-a1",
      key: "A1",
      label: "Section A1",
      title: "Section A1: Safe Isolation and Risk Assessment (45 mins)",
      duration: "45 mins",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2ev1-a1-1",
          text: "Carry out and document an assessment of risk",
        },
        {
          id: "am2ev1-a1-2",
          text: "Carry out safe isolation in the correct sequence considering any separate energy systems",
        },
      ],
    },
    {
      id: "am2ev1-section-a2-a6",
      key: "A2-A6",
      label: "Sections A2-A6",
      title: "Sections A2-A6: Composite Installation (10.5 hours)",
      duration: "10.5 hours",
      summary:
        "This section has areas where candidates will need to demonstrate occupational competence in accordance with statutory and non-statutory regulations and approved industry working practices.",
      items: [
        {
          id: "am2ev1-a2-1",
          text: "Interpretation of specifications and technical data",
        },
        {
          id: "am2ev1-a2-2",
          text: "Selection of protective devices, single pole and triple pole",
        },
        {
          id: "am2ev1-a2-3",
          text: "Install protective equipotential bonding",
        },
        {
          id: "am2ev1-a2-4",
          text: "Install and terminate PVC singles cable",
        },
        {
          id: "am2ev1-a2-5",
          text: "Install and terminate PVC/PVC multi-core & cpc cable",
        },
        {
          id: "am2ev1-a2-6",
          text: "Install and terminate SY multi-flex cable",
        },
        {
          id: "am2ev1-a2-7",
          text: "Install and terminate heat-resistant flex",
        },
        {
          id: "am2ev1-a2-8",
          text: "Install and terminate XLPE SWA",
        },
        {
          id: "am2ev1-a2-9",
          text: "Install and terminate data-cable",
        },
        {
          id: "am2ev1-a2-10",
          text: "Install and terminate FP200 type cable",
        },
        {
          id: "am2ev1-a2-11",
          text: "Form and install metal conduit systems",
        },
        {
          id: "am2ev1-a2-12",
          text: "Form and install PVC conduit systems",
        },
        {
          id: "am2ev1-a2-13",
          text: "Install protective devices in a TP&N distribution board",
        },
        {
          id: "am2ev1-a2-14",
          text: "Install a two-way, intermediate and key switch for various lighting circuits in PVC/PVC multi-core cable",
        },
        {
          id: "am2ev1-a2-15",
          text: "Install a BS 1363 13A socket outlet ring circuit using PVC single cables",
        },
        {
          id: "am2ev1-a2-16",
          text: "Install a carbon monoxide detector safety service circuit in FP200 type cable",
        },
        {
          id: "am2ev1-a2-17",
          text: "Install data outlets circuit in Cat. 5 cable",
        },
        {
          id: "am2ev1-a2-18",
          text: "Install a BS EN 60309 20A T P & N supply in XLPE SWA cable for electric vehicle pillar",
        },
        {
          id: "am2ev1-a2-19",
          text: "Install protective equipotential bonding to gas and water services",
        },
        {
          id: "am2ev1-a2-20",
          text: "Connect a 3-phase direct online motor circuit in SY cable with remote start stop function using PVC singles",
        },
        {
          id: "am2ev1-a2-21",
          text: "Install an S Plan central heating and hot water system with a solar thermal sustainable energy element utilising heat resistant flexible cable and PVC singles cable",
        },
      ],
    },
    {
      id: "am2ev1-section-b",
      key: "B",
      label: "Section B",
      title: "Section B: Inspection, Testing and Certification (3.5 hours)",
      duration: "3.5 hours",
      summary:
        "In this area candidates will be expected to follow practices and procedures that take into account electrically sensitive equipment. To demonstrate occupational competence, candidates will be expected to:",
      items: [
        {
          id: "am2ev1-b-1",
          text: "Work according to best practice as required by Health and Safety legislation",
        },
        {
          id: "am2ev1-b-2",
          text: "Ensure the installation is correctly isolated before commencing the inspection and test activity taking into account any renewable sources",
        },
        {
          id: "am2ev1-b-3",
          text: "Carry out a visual inspection of the installation in accordance with BS 7671 and IET Guidance Note 3",
        },
        {
          id: "am2ev1-b-4",
          text: "Continuity of protective conductors",
        },
        {
          id: "am2ev1-b-5",
          text: "Continuity of ring final circuit conductors",
        },
        {
          id: "am2ev1-b-6",
          text: "Insulation resistance",
        },
        {
          id: "am2ev1-b-7",
          text: "Polarity",
        },
        {
          id: "am2ev1-b-8",
          text: "Earth fault-loop impedance (EFLI)",
        },
        {
          id: "am2ev1-b-9",
          text: "Prospective fault current (PFC)",
        },
        {
          id: "am2ev1-b-10",
          text: "Check for phase sequence and phase rotation",
        },
        {
          id: "am2ev1-b-11",
          text: "Functional testing",
        },
        {
          id: "am2ev1-b-12",
          text: "Verify that the test results obtained conform to the values required by BS 7671 and IET Guidance Note 3",
        },
        {
          id: "am2ev1-b-13",
          text: "Complete an electrical installation certificate, schedule of inspections and schedule of test results using the model forms as illustrated in Appendix 6 of BS 7671",
        },
      ],
    },
    {
      id: "am2ev1-section-c",
      key: "C",
      label: "Section C",
      title: "Section C: Safe Isolation of Circuits (30 mins)",
      duration: "30 mins",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2ev1-c-1",
          text: "Carry out safe isolation in the correct sequence on a single-phase circuit",
        },
        {
          id: "am2ev1-c-2",
          text: "Carry out safe isolation in the correct sequence on a three-phase circuit",
        },
        {
          id: "am2ev1-c-3",
          text: "Carry out safe isolation in the correct sequence on a three-phase installation",
        },
      ],
    },
    {
      id: "am2ev1-section-d",
      key: "D",
      label: "Section D",
      title: "Section D: Fault Diagnosis and Rectification (2 hours)",
      duration: "2 hours",
      summary:
        "To demonstrate occupational competence candidates will be expected to:",
      items: [
        {
          id: "am2ev1-d-1",
          text: "Work according to best practice as required by Health and Safety legislation",
        },
        {
          id: "am2ev1-d-2",
          text: "Correctly select and use tools, equipment and test instruments.",
        },
        {
          id: "am2ev1-d-3",
          text: "Carry out checks and preparations that must be completed prior to undertaking fault diagnosis",
        },
        {
          id: "am2ev1-d-4",
          text: "Identify faults from 'fault symptom' information.",
        },
        {
          id: "am2ev1-d-5",
          text: "State and record how the identified faults can be rectified",
        },
      ],
    },
    {
      id: "am2ev1-section-e",
      key: "E",
      label: "Section E",
      title: "Section E: Assessment of Applied Knowledge (1.5 hours)",
      duration: "1.5 hours",
      summary:
        "This assessment will last for 1.5 hours and be in the form of a computerised multiple-choice test. Candidates will be expected to answer 40 questions and will be assessed on their application of knowledge associated with:",
      items: [
        {
          id: "am2ev1-e-1",
          text: "Health and Safety",
        },
        {
          id: "am2ev1-e-2",
          text: "BS 7671: Requirements for Electrical Installations including any current amendments",
        },
        {
          id: "am2ev1-e-3",
          text: "Building Regulations",
        },
        {
          id: "am2ev1-e-4",
          text: "Inspection, Testing and Fault Finding",
        },
      ],
    },
  ];
}

function buildChecklistTemplates(variant = "am2") {
  if (variant === "am2e") {
    return buildAm2eFullChecklistTemplates();
  }

  if (variant === "am2e-v1") {
    return buildAm2eV1ChecklistTemplates();
  }

  return buildAm2ChecklistTemplates();
}

function normalizeChecklistTemplateItem(templateItem, sectionId, index) {
  if (typeof templateItem === "string") {
    return {
      id: `${sectionId}-item-${index + 1}`,
      no: index + 1,
      criterion: templateItem,
    };
  }

  const itemId = normalizeString(templateItem?.id) || `${sectionId}-item-${index + 1}`;
  const criterion =
    normalizeString(templateItem?.criterion) ||
    normalizeString(templateItem?.text) ||
    normalizeString(templateItem?.label);
  const itemNumber = normalizeChecklistItemNumber(templateItem?.no ?? templateItem?.number);

  return {
    id: itemId,
    no: itemNumber || index + 1,
    criterion,
  };
}

function normalizeChecklistLevel(value) {
  const normalizedValue = normalizeString(value).toLowerCase();
  return ["extensive", "adequate", "limited", "unsure", "acceptable", "unusual"].includes(
    normalizedValue
  )
    ? normalizedValue
    : "";
}

function extractChecklistLevel(value) {
  if (typeof value === "string") {
    return normalizeChecklistLevel(value);
  }

  if (value && typeof value === "object") {
    const booleanSelectedOption = getChecklistOptionSet("knowledge").find(
      (option) => value[option.id] === true
    );

    if (booleanSelectedOption) {
      return booleanSelectedOption.id;
    }

    return (
      normalizeChecklistLevel(value.id) ||
      normalizeChecklistLevel(value.label) ||
      normalizeChecklistLevel(value.value) ||
      normalizeChecklistLevel(value.level)
    );
  }

  return "";
}

function normalizeChecklistItemNumber(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function buildChecklistTemplateLookups(variant = "am2") {
  const templates = buildChecklistTemplates(variant);
  const validItemIds = new Set();
  const criterionToItemId = new Map();
  const sectionKeyToSectionId = new Map();
  const sectionNumberToItemId = new Map();

  templates.forEach((section) => {
    sectionKeyToSectionId.set(normalizeString(section.key).toLowerCase(), section.id);
    sectionKeyToSectionId.set(normalizeString(section.id).toLowerCase(), section.id);

    section.items.forEach((templateItem, index) => {
      const item = normalizeChecklistTemplateItem(templateItem, section.id, index);
      validItemIds.add(item.id);
      sectionNumberToItemId.set(`${section.id}:${item.no}`, item.id);

      if (item.criterion) {
        criterionToItemId.set(item.criterion.toLowerCase(), item.id);
      }
    });
  });

  return {
    validItemIds,
    criterionToItemId,
    sectionKeyToSectionId,
    sectionNumberToItemId,
  };
}

function resolveChecklistResponseItemId(response, lookups, fallbackContext = {}) {
  const directIds = [
    response?.itemId,
    response?.id,
    response?.item?.id,
  ]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  const matchedDirectId = directIds.find((itemId) => lookups.validItemIds.has(itemId));
  if (matchedDirectId) {
    return matchedDirectId;
  }

  const sectionId =
    normalizeString(response?.sectionId) ||
    normalizeString(response?.section?.id) ||
    normalizeString(fallbackContext.sectionId);
  const sectionKey =
    normalizeString(response?.sectionKey) ||
    normalizeString(response?.section?.key) ||
    normalizeString(fallbackContext.sectionKey);
  const resolvedSectionId =
    sectionId ||
    lookups.sectionKeyToSectionId.get(sectionKey.toLowerCase()) ||
    "";
  const itemNumber = normalizeChecklistItemNumber(
    response?.no ?? response?.number ?? response?.itemNo ?? response?.index
  );

  if (resolvedSectionId && itemNumber) {
    const mappedItemId = lookups.sectionNumberToItemId.get(`${resolvedSectionId}:${itemNumber}`);
    if (mappedItemId) {
      return mappedItemId;
    }

    const sectionItemId = `${resolvedSectionId}-item-${itemNumber}`;
    if (lookups.validItemIds.has(sectionItemId)) {
      return sectionItemId;
    }
  }

  const criterion =
    normalizeString(response?.criterion) ||
    normalizeString(response?.text) ||
    normalizeString(response?.label) ||
    normalizeString(response?.item?.criterion) ||
    normalizeString(response?.item?.text);

  if (criterion) {
    return lookups.criterionToItemId.get(criterion.toLowerCase()) || "";
  }

  return "";
}

function collectChecklistPayloadResponses(body) {
  const collected = [];

  if (Array.isArray(body?.responses)) {
    collected.push(...body.responses);
  }

  if (Array.isArray(body?.items)) {
    collected.push(...body.items);
  }

  const sectionCollections = [
    ...(Array.isArray(body?.sections) ? body.sections : []),
    ...(Array.isArray(body?.checklistSections) ? body.checklistSections : []),
    ...(body?.activeSection && Array.isArray(body.activeSection.items) ? [body.activeSection] : []),
  ];

  sectionCollections.forEach((section) => {
    const items = Array.isArray(section?.items) ? section.items : [];
    items.forEach((item) => {
      collected.push({
        ...item,
        sectionId: normalizeString(item?.sectionId) || normalizeString(section?.id),
        sectionKey: normalizeString(item?.sectionKey) || normalizeString(section?.key),
      });
    });
  });

  return collected;
}

function getChecklistResponseMap(booking) {
  const responses = Array.isArray(booking.checklistResponses) ? booking.checklistResponses : [];
  return new Map(
    responses
      .filter((response) => normalizeString(response.itemId))
      .map((response) => [
        response.itemId,
        {
          knowledgeLevel: normalizeChecklistLevel(response.knowledgeLevel),
          experienceLevel: normalizeChecklistLevel(response.experienceLevel),
        },
      ])
  );
}

function getChecklistOptionSet(type) {
  if (type === "experience") {
    return [
      { id: "extensive", label: "Extensive" },
      { id: "adequate", label: "Adequate" },
      { id: "limited", label: "Limited" },
      { id: "unsure", label: "Unsure" },
    ];
  }

  return [
    { id: "extensive", label: "Extensive" },
    { id: "adequate", label: "Adequate" },
    { id: "limited", label: "Limited" },
    { id: "unsure", label: "Unsure" },
  ];
}

function buildChecklistBooleanOptionMap(selectedValue) {
  const normalizedSelectedValue = normalizeChecklistLevel(selectedValue);

  return getChecklistOptionSet("knowledge").reduce((accumulator, option) => {
    accumulator[option.id] = option.id === normalizedSelectedValue;
    return accumulator;
  }, {});
}

function buildChecklistResponsesForClient(booking) {
  return (Array.isArray(booking?.checklistResponses) ? booking.checklistResponses : [])
    .map((response) => {
      const itemId = normalizeString(response?.itemId);
      const knowledgeLevel = normalizeChecklistLevel(response?.knowledgeLevel);
      const experienceLevel = normalizeChecklistLevel(response?.experienceLevel);

      if (!itemId) {
        return null;
      }

      return {
        itemId,
        knowledgeLevel,
        experienceLevel,
        knowledge: buildChecklistBooleanOptionMap(knowledgeLevel),
        experience: buildChecklistBooleanOptionMap(experienceLevel),
      };
    })
    .filter(Boolean);
}

function buildChecklistFlowItem(templateItem, sectionId, index) {
  const item = normalizeChecklistTemplateItem(templateItem, sectionId, index);

  return {
    id: item.id,
    no: item.no,
    criterion: item.criterion,
    text: item.criterion,
    knowledgeLevel: "",
    experienceLevel: "",
    knowledge: buildChecklistBooleanOptionMap(""),
    experience: buildChecklistBooleanOptionMap(""),
    options: {
      knowledge: getChecklistOptionSet("knowledge"),
      experience: getChecklistOptionSet("experience"),
    },
  };
}

function getChecklistVariantForBooking(booking) {
  const selectedOption = findEligibilityOptionById(booking?.eligibilityCheck?.nvqRegistrationDate);
  if (selectedOption?.leadsToVariant) {
    return selectedOption.leadsToVariant;
  }

  const snapshotVariant = normalizeChecklistVariant(booking?.courseSnapshot?.assessmentVariant);
  if (snapshotVariant) {
    return snapshotVariant;
  }

  const populatedCourseVariant = normalizeChecklistVariant(booking?.course?.assessmentVariant);
  if (populatedCourseVariant) {
    return populatedCourseVariant;
  }

  return inferChecklistVariantFromCourse(booking?.courseSnapshot || booking?.course || {}).variant;
}

function buildChecklistSectionsForBooking(booking, variant = getChecklistVariantForBooking(booking)) {
  const templates = buildChecklistTemplates(variant);
  const responseMap = getChecklistResponseMap(booking);

  return templates.map((section) => {
    const items = section.items.map((templateItem, index) => {
      const item = normalizeChecklistTemplateItem(templateItem, section.id, index);
      const itemId = item.id;
      const response = responseMap.get(itemId) || {
        knowledgeLevel: "",
        experienceLevel: "",
      };
      const completed = Boolean(response.knowledgeLevel && response.experienceLevel);

      return {
        id: itemId,
        no: item.no,
        criterion: item.criterion,
        text: item.criterion,
        knowledgeLevel: response.knowledgeLevel,
        experienceLevel: response.experienceLevel,
        knowledge: buildChecklistBooleanOptionMap(response.knowledgeLevel),
        experience: buildChecklistBooleanOptionMap(response.experienceLevel),
        completed,
        options: {
          knowledge: getChecklistOptionSet("knowledge"),
          experience: getChecklistOptionSet("experience"),
        },
      };
    });

    return {
      ...section,
      completedItems: items.filter((item) => item.completed).length,
      totalItems: items.length,
      items,
    };
  });
}

function calculateChecklistCompletion(sections) {
  const totalItems = sections.reduce((sum, section) => sum + section.totalItems, 0);
  const completedItems = sections.reduce((sum, section) => sum + section.completedItems, 0);

  return {
    totalItems,
    completedItems,
    percentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0,
  };
}

function isBookingDocumentsComplete(booking) {
  const requirements = buildDocumentRequirements(booking);
  return requirements.every((requirement) => requirement.uploaded);
}

function isBookingChecklistComplete(booking) {
  return calculateChecklistCompletion(buildChecklistSectionsForBooking(booking)).percentage === 100;
}

function isBookingReadyForSubmit(booking) {
  return isBookingDocumentsComplete(booking) && isBookingChecklistComplete(booking);
}

function buildBookingFlowDocumentsScreen(booking) {
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);
  const checklistMetadata = getChecklistVariantMetadata(variantMetadata.checklistVariant);
  const requirements = buildDocumentRequirements(booking);
  const uploadedCount = requirements.filter((requirement) => requirement.uploaded).length;
  const documentsComplete = requirements.length === 0 || uploadedCount === requirements.length;

  return {
    steps: buildBookingFlowSteps("documents"),
    checklistVariant: variantMetadata.checklistVariant,
    assessmentVariant: variantMetadata.assessmentVariant,
    templateId: variantMetadata.templateId,
    resolvedFrom: variantMetadata.resolvedFrom,
    pdfExport: variantMetadata.pdfExport,
    title: "Upload Full Certificate",
    subtitle: checklistMetadata.title,
    importantInformation: "You must upload all required documents before proceeding.",
    course: {
      id: booking.course?._id || booking.course,
      title: booking.courseSnapshot?.title || "",
      slug: booking.courseSnapshot?.slug || "",
    },
    requirements,
    completion: {
      uploadedCount,
      totalRequired: requirements.length,
      percentage: requirements.length ? Math.round((uploadedCount / requirements.length) * 100) : 0,
    },
    actions: {
      continue: {
        label: "Continue",
        enabled: documentsComplete,
        disabledReason: documentsComplete
          ? ""
          : "Upload all required documents before continuing.",
        apiUrl: `/api/bookings/${booking._id}/flow/checklist`,
      },
    },
  };
}

function buildBookingFlowChecklistSummaryScreen(booking) {
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);
  const checklistMetadata = getChecklistVariantMetadata(variantMetadata.checklistVariant);
  const sections = buildChecklistSectionsForBooking(booking, checklistMetadata.variant);
  const completion = calculateChecklistCompletion(sections);

  return {
    steps: buildBookingFlowSteps("checklist"),
    checklistVariant: variantMetadata.checklistVariant,
    assessmentVariant: variantMetadata.assessmentVariant,
    templateId: variantMetadata.templateId,
    resolvedFrom: variantMetadata.resolvedFrom,
    pdfExport: variantMetadata.pdfExport,
    card: {
      title: checklistMetadata.title,
      subtitle: checklistMetadata.subtitle,
    },
    importantInformation: "Important Information",
    overallCompletion: completion.percentage,
    notice:
      completion.percentage === 100
        ? "Complete all sections of the checklist. You can use the full checklist page for a detailed view."
        : "Complete all sections of the checklist. You can use the full checklist page for a detailed view.",
    actions: {
      openFullChecklist: {
        label: "Open Full Checklist",
        apiUrl: `/api/bookings/${booking._id}/flow/checklist/full`,
      },
      continue: {
        label: "Continue",
        enabled: completion.percentage === 100,
        apiUrl: `/api/bookings/${booking._id}/flow/signatures`,
      },
    },
  };
}

function buildBookingFlowChecklistFullScreen(booking, activeSectionKey) {
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);
  const checklistMetadata = getChecklistVariantMetadata(variantMetadata.checklistVariant);
  const sections = buildChecklistSectionsForBooking(booking, checklistMetadata.variant);
  const completion = calculateChecklistCompletion(sections);
  const activeSection =
    sections.find((section) => section.key.toLowerCase() === String(activeSectionKey || "").toLowerCase()) ||
    sections[0];

  return {
    steps: buildBookingFlowSteps("checklist"),
    checklistVariant: variantMetadata.checklistVariant,
    assessmentVariant: variantMetadata.assessmentVariant,
    templateId: variantMetadata.templateId,
    resolvedFrom: variantMetadata.resolvedFrom,
    pdfExport: variantMetadata.pdfExport,
    title: checklistMetadata.title,
    subtitle: checklistMetadata.description,
    overallCompletion: completion.percentage,
    actions: {
      saveDraft: {
        label: "Save Draft",
        method: "PATCH",
        apiUrl: `/api/bookings/${booking._id}/flow/checklist`,
      },
      nextSection: {
        label:
          activeSection.key === "E"
            ? "Submit"
            : "Next Section",
        apiUrl:
          activeSection.key === "E"
            ? `/api/bookings/${booking._id}/flow/checklist`
            : `/api/bookings/${booking._id}/flow/checklist/full?section=${encodeURIComponent(
                sections[Math.min(sections.indexOf(activeSection) + 1, sections.length - 1)].key
              )}`,
      },
    },
    sections: sections.map((section) => ({
      id: section.id,
      key: section.key,
      label: section.label,
      completedItems: section.completedItems,
      totalItems: section.totalItems,
      active: section.id === activeSection.id,
      apiUrl: `/api/bookings/${booking._id}/flow/checklist/full?section=${encodeURIComponent(section.key)}`,
    })),
    activeSection: {
      id: activeSection.id,
      key: activeSection.key,
      title: activeSection.title,
      summary: activeSection.summary,
      duration: activeSection.duration,
      completedItems: activeSection.completedItems,
      totalItems: activeSection.totalItems,
      items: activeSection.items,
    },
  };
}

function buildBookingFlowSignaturesScreen(booking) {
  const checklistVariant = getChecklistVariantForBooking(booking);
  const candidateSignatureStatus = getCandidateSignatureStatus(booking);
  const providerSignatureStatus = getTrainingProviderSignatureStatus(booking);
  const requestDetails = booking.trainingProviderSignatureRequest || {};
  const providerLink = requestDetails.token ? getTrainingProviderSignatureLink(requestDetails.token) : "";
  const candidateSignature = {
    ...mapSignatureForClient(booking.candidateSignature || {}),
    status: candidateSignatureStatus,
  };
  const candidateDeclaration = buildCandidateReadinessDeclaration(
    checklistVariant,
    booking.candidateSignature || {},
    {
      printName:
        booking.personalDetails?.fullName ||
        booking.candidateSignature?.signerName ||
        booking.user?.name ||
        "",
    }
  );
  const trainingProviderSignature = {
    ...mapSignatureForClient(booking.trainingProviderSignature || {}),
    status: providerSignatureStatus,
  };

  return {
    steps: buildBookingFlowSteps("signatures"),
    signatures: buildBookingSignaturesPayload(booking),
    candidateDeclaration,
    card: {
      title: booking.personalDetails?.fullName || booking.courseSnapshot?.title || "Booking",
      subtitle: "Readiness for Assessment: Candidate Self-Assessment Checklist",
    },
    importantInformation: "Important Information",
    progressLabel: "Step 1 of 2",
    items: [
      {
        id: "candidate",
        label: "Candidate",
        status: candidateSignatureStatus,
        signature: candidateSignature,
        declaration: candidateDeclaration,
        signatureImage: candidateDeclaration.signatureImage,
        imageUrl: candidateDeclaration.imageUrl,
        signatureImageUrl: candidateDeclaration.signatureImageUrl,
        previewUrl: candidateDeclaration.previewUrl,
        date: candidateDeclaration.date,
        dateValue: candidateDeclaration.dateValue,
        dateLabel: candidateDeclaration.dateLabel,
        action: {
          label: "Submit Signature",
          method: "POST",
          apiUrl: `/api/bookings/${booking._id}/flow/signatures/candidate`,
        },
        modal: {
          title: "Upload your signature",
          fields: [
            { id: "signatureType", label: "Signature Type", type: "radio", options: ["draw", "upload"] },
            { id: "signatureData", label: "Signature Data", type: "text", required: true },
            { id: "fileName", label: "File Name", type: "text", required: false },
          ],
        },
      },
      {
        id: "training_provider",
        label: "Training Provider",
        status: providerSignatureStatus,
        signature: trainingProviderSignature,
        action: {
          label: "Ask for signed",
          method: "POST",
          apiUrl: `/api/bookings/${booking._id}/flow/signatures/training-provider/request`,
        },
        request: {
          email: requestDetails.email || "",
          name: requestDetails.name || "",
          subject: requestDetails.subject || "",
          message: requestDetails.message || "",
          link: providerLink,
          expiresAt: requestDetails.expiresAt || null,
        },
      },
    ],
    actions: {
      continue: {
        label: "Continue",
        enabled: true,
        apiUrl: `/api/bookings/${booking._id}/flow/submit`,
      },
    },
  };
}

function buildBookingFlowSubmitScreen(booking) {
  const checklistMetadata = getChecklistVariantMetadata(getChecklistVariantForBooking(booking));
  const readyForSubmit = isBookingReadyForSubmit(booking);
  const documentRequirements = buildDocumentRequirements(booking);
  const documentCompletion = {
    uploadedCount: documentRequirements.filter((requirement) => requirement.uploaded).length,
    totalRequired: documentRequirements.length,
    percentage: documentRequirements.length
      ? Math.round(
          (documentRequirements.filter((requirement) => requirement.uploaded).length /
            documentRequirements.length) *
            100
        )
      : 0,
  };
  const sections = [
    {
      id: "documents",
      label: "Supporting Documents",
      status: isBookingDocumentsComplete(booking) ? "uploaded" : "pending",
    },
    {
      id: "registration",
      label: "NET Candidate Registration Form",
      status: hasRegistrationValue(booking.personalDetails) ? "uploaded" : "pending",
    },
    {
      id: "checklist",
      label: checklistMetadata.title,
      status: isBookingChecklistComplete(booking) ? "completed" : "pending",
    },
    {
      id: "candidate-signature",
      label: "Candidate Signature",
      status: getCandidateSignatureStatus(booking) === "signed" ? "signed" : "optional",
    },
    {
      id: "provider-signature",
      label: "Training Provider Signature",
      status: getTrainingProviderSignatureStatus(booking) === "signed" ? "signed" : "optional",
    },
  ];

  return {
    steps: buildBookingFlowSteps("submit"),
    title: "Review & Submit",
    subtitle: "Review your application before submitting to the admin for approval.",
    notice:
      "Once submitted, the admin will review your documents, checklist, and signatures. You'll be notified when your application is approved and you can proceed to payment.",
    documents: {
      requirements: documentRequirements,
      completion: documentCompletion,
      uploadedItems: getBookingDocumentsArray(booking).map((document) =>
        mapUploadedBookingDocument(document)
      ),
    },
    sections,
    actions: {
      back: {
        label: "Back",
        apiUrl: `/api/bookings/${booking._id}/flow/signatures`,
      },
      submit: {
        label: "Submit Application",
        method: "POST",
        enabled: readyForSubmit,
        apiUrl: `/api/bookings/${booking._id}/flow/submit`,
      },
    },
  };
}

function buildBookingFlowReviewScreen(booking) {
  const applicationStatus = booking.applicationStatus || "draft";
  const reviewLabels = {
    draft: "Draft",
    submitted: "Pending Review",
    under_review: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
  };
  const reviewState = {
    submitted: {
      title: "Application Submitted",
      description:
        "Your application has been submitted and is waiting for admin review. You'll be notified once it's approved.",
      badge: "Pending Review",
    },
    under_review: {
      title: "Under Review",
      description: "Admin is currently reviewing your application.",
      badge: "Under Review",
    },
    approved: {
      title: "Application Approved!",
      description:
        "The admin has reviewed and approved your documents, checklist, and signatures. You can now proceed to payment.",
      badge: "Approved",
    },
    rejected: {
      title: "Application Rejected",
      description: "The admin reviewed your application and marked it as rejected.",
      badge: "Rejected",
    },
    draft: {
      title: "Draft Review",
      description: "Your application has not been submitted yet.",
      badge: "Draft",
    },
  }[applicationStatus] || {
    title: "Admin Review",
    description: "Your application is being reviewed by the admin team.",
    badge: "Pending Review",
  };

  return {
    steps: buildBookingFlowSteps("review"),
    title: "Admin Review",
    subtitle: "Your application is being reviewed by the admin team.",
    notice:
      "Once submitted, the admin will review your documents, checklist, and signatures. You'll be notified when your application is approved and you can proceed to payment.",
    status: {
      key: applicationStatus,
      label: reviewLabels[applicationStatus] || "Draft",
    },
    submittedAt: booking.submittedAt || null,
    reviewedAt: booking.reviewedAt || null,
    notes: booking.notes || "",
    stateCard: reviewState,
    actions: {
      back: {
        label: "Back",
        apiUrl: `/api/bookings/${booking._id}/flow/submit`,
      },
      continue: {
        label: "Proceed to Payment",
        enabled: applicationStatus === "approved",
        apiUrl: `/api/bookings/${booking._id}/checkout/payment`,
      },
    },
  };
}

function buildTrainingProviderSignatureScreen(booking) {
  const request = booking.trainingProviderSignatureRequest || {};
  const signature = booking.trainingProviderSignature || {};
  const signatureDetails = mapSignatureForClient(signature);
  const isSigned = signatureDetails.status === "signed";

  return {
    title: "Training Provider Signature",
    subtitle: booking.personalDetails?.fullName || booking.courseSnapshot?.title || "Booking",
    provider: {
      email: request.email || "",
      name: request.name || "",
    },
    booking: {
      id: booking._id,
      bookingNumber: booking.bookingNumber,
      courseTitle: booking.courseSnapshot?.title || "",
      candidateName: booking.personalDetails?.fullName || "",
    },
    signature: signatureDetails,
    actions: {
      submit: {
        label: "Submit Signature",
        method: "POST",
        enabled: !isSigned,
        apiUrl: request.token ? `/api/bookings/provider-signature/${request.token}` : "",
        contentType: "multipart/form-data",
        uploadFields: ["file", "image", "signature", "candidateSignature"],
      },
    },
  };
}

function mapBookingSummary(booking, options = {}) {
  const { includeUser = false, includeAdminActions = false } = options;
  const tab = getBookingTab(booking);
  const statusBadge = getBookingStatusBadge(booking, tab);
  const sessionStartDateTime = booking.session?.startDateTime || null;
  const sessionEndDateTime = booking.session?.endDateTime || null;
  const sessionLocation = booking.session?.location || booking.courseSnapshot?.location || "";
  const checklistVariant = getChecklistVariantForBooking(booking);
  const coursePricing = buildBookingCoursePricing(booking);

  const summary = {
    id: booking._id,
    bookingNumber: booking.bookingNumber,
    checklistVariant,
    assessmentVariant: checklistVariant,
    status: booking.status,
    paymentStatus: booking.payment?.status || "pending",
    tab,
    statusBadge,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    confirmedAt: booking.confirmedAt,
    cancelledAt: booking.cancelledAt,
    session: {
      startDateTime: sessionStartDateTime,
      endDateTime: sessionEndDateTime,
      displayDate: formatDisplayDate(sessionStartDateTime),
      displayTime: formatDisplayTime(sessionStartDateTime),
      displayDateTime: formatDisplayDateTime(sessionStartDateTime),
      location: sessionLocation,
    },
    course: {
      id: booking.course?._id || booking.course,
      title: booking.courseSnapshot?.title || "",
      slug: booking.courseSnapshot?.slug || "",
      schedule: booking.courseSnapshot?.schedule || "",
      duration: booking.courseSnapshot?.duration || "",
      location: booking.courseSnapshot?.location || "",
      qualification: booking.courseSnapshot?.qualification || "",
      assessmentVariant: booking.courseSnapshot?.assessmentVariant || checklistVariant,
      thumbnailUrl: booking.courseSnapshot?.thumbnailUrl || "",
      price: coursePricing.totalAmount,
      basePrice: coursePricing.amount,
      currency: booking.payment?.currency || booking.courseSnapshot?.currency || "GBP",
      displayPrice: coursePricing.displayPrice,
      pricing: coursePricing,
      detailsUrl: booking.courseSnapshot?.slug ? `/courses/${booking.courseSnapshot.slug}` : "",
    },
    actions: {
      detailsLabel: "Course Details",
      detailsUrl: booking.courseSnapshot?.slug ? `/courses/${booking.courseSnapshot.slug}` : "",
    },
  };

  if (includeUser && booking.user) {
    summary.user = buildUserSummary(booking.user);
  }

  if (includeAdminActions) {
    summary.actions.view = {
      label: "View Booking",
      type: "view_booking",
      url: `/admin/bookings/${booking._id}`,
      apiUrl: `/api/admin/bookings/${booking._id}`,
    };
    summary.actions.candidate = {
      label: "View Candidate",
      type: "view_candidate",
      url: `/admin/candidates/${booking._id}`,
      apiUrl: `/api/admin/candidates/${booking._id}`,
    };
  }

  return summary;
}

function mapBookingDetail(booking, options = {}) {
  const registrationProgress = buildRegistrationProgress(booking);
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);

  return {
    ...mapBookingSummary(booking, options),
    checklistVariantMetadata: variantMetadata,
    pdfExport: variantMetadata.pdfExport,
    personalDetails: {
      title: booking.personalDetails?.title || "",
      firstName: booking.personalDetails?.firstName || "",
      lastName: booking.personalDetails?.lastName || "",
      niNumber: booking.personalDetails?.niNumber || "",
      fullName: booking.personalDetails?.fullName || "",
      email: booking.personalDetails?.email || "",
      phoneNumber: booking.personalDetails?.phoneNumber || "",
      mobileNumber: booking.personalDetails?.phoneNumber || "",
      dateOfBirth: formatDateOnly(booking.personalDetails?.dateOfBirth),
      address: booking.personalDetails?.address || "",
      addressLine1: booking.personalDetails?.addressLine1 || "",
      addressLine2: booking.personalDetails?.addressLine2 || "",
      trainingCenter: booking.personalDetails?.trainingCenter || "",
      city: booking.personalDetails?.city || "",
      town: booking.personalDetails?.town || booking.personalDetails?.city || "",
      postcode: booking.personalDetails?.postcode || "",
    },
    eligibilityCheck: {
      qualificationId: booking.eligibilityCheck?.qualificationId || "",
      qualificationLabel: booking.eligibilityCheck?.qualificationLabel || "",
      nvqRegistrationDate: booking.eligibilityCheck?.nvqRegistrationDate || "",
    },
    assessmentDetails: {
      apprentice: booking.assessmentDetails?.apprentice || "",
      uln: booking.assessmentDetails?.uln || "",
      funding: booking.assessmentDetails?.funding || "",
      awardingBody: booking.assessmentDetails?.awardingBody || "",
      reasonableAdjustments: booking.assessmentDetails?.reasonableAdjustments || "",
      recognitionOfPriorLearning: booking.assessmentDetails?.recognitionOfPriorLearning || "",
      assessmentType: booking.assessmentDetails?.assessmentType || "",
    },
    employerDetails: {
      companyName: booking.employerDetails?.companyName || "",
      email: booking.employerDetails?.email || "",
      contactName: booking.employerDetails?.contactName || "",
      contactNumber: booking.employerDetails?.contactNumber || "",
      address1: booking.employerDetails?.address1 || "",
      address2: booking.employerDetails?.address2 || "",
      address3: booking.employerDetails?.address3 || "",
      address4: booking.employerDetails?.address4 || "",
      town: booking.employerDetails?.town || "",
      postcode: booking.employerDetails?.postcode || "",
    },
    trainingProviderDetails: {
      companyName: booking.trainingProviderDetails?.companyName || "",
      email: booking.trainingProviderDetails?.email || "",
      contactName: booking.trainingProviderDetails?.contactName || "",
      contactNumber: booking.trainingProviderDetails?.contactNumber || "",
      address1: booking.trainingProviderDetails?.address1 || "",
      address2: booking.trainingProviderDetails?.address2 || "",
      address3: booking.trainingProviderDetails?.address3 || "",
      address4: booking.trainingProviderDetails?.address4 || "",
      town: booking.trainingProviderDetails?.town || "",
      postcode: booking.trainingProviderDetails?.postcode || "",
    },
    candidateSignature: {
      ...mapSignatureForClient(booking.candidateSignature || {}),
      status: booking.candidateSignature?.status || getCandidateSignatureStatus(booking),
    },
    trainingProviderSignature: {
      ...mapSignatureForClient(booking.trainingProviderSignature || {}),
      status: booking.trainingProviderSignature?.status || getTrainingProviderSignatureStatus(booking),
    },
    signatures: buildBookingSignaturesPayload(booking),
    trainingProviderSignatureRequest: {
      email: booking.trainingProviderSignatureRequest?.email || "",
      name: booking.trainingProviderSignatureRequest?.name || "",
      subject: booking.trainingProviderSignatureRequest?.subject || "",
      message: booking.trainingProviderSignatureRequest?.message || "",
      expiresAt: booking.trainingProviderSignatureRequest?.expiresAt || null,
      lastSentAt: booking.trainingProviderSignatureRequest?.lastSentAt || null,
      link: booking.trainingProviderSignatureRequest?.token
        ? getTrainingProviderSignatureLink(booking.trainingProviderSignatureRequest.token)
        : "",
    },
    privacyConfirmation: Boolean(booking.privacyConfirmation),
    privacyConfirmedAt: booking.privacyConfirmedAt || null,
    applicationStatus: booking.applicationStatus || "draft",
    submittedAt: booking.submittedAt || null,
    reviewedAt: booking.reviewedAt || null,
    registration: {
      ...registrationProgress,
      endpoints: buildRegistrationEndpoints(booking._id),
    },
    payment: {
      status: booking.payment?.status || "pending",
      amount: booking.payment?.amount ?? 0,
      currency: booking.payment?.currency || "GBP",
      displayAmount: formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP"),
      pricing: buildBookingCoursePricing(booking),
      agreedToTerms: Boolean(booking.payment?.agreedToTerms),
      method: booking.payment?.method || "card",
      transactionId: booking.payment?.transactionId || "",
      cardBrand: booking.payment?.cardBrand || "",
      cardLast4: booking.payment?.cardLast4 || "",
      paidAt: booking.payment?.paidAt || null,
      failureReason: booking.payment?.failureReason || "",
      stripePaymentIntentId: booking.payment?.stripePaymentIntentId || "",
      stripePaymentIntentStatus: booking.payment?.stripePaymentIntentStatus || "",
      stripePaymentMethodId: booking.payment?.stripePaymentMethodId || "",
    },
    progress: {
      details: "completed",
      payment: booking.payment?.status === "paid" ? "completed" : "pending",
      confirmation: booking.status === "confirmed" ? "completed" : "pending",
    },
    notes: booking.notes || "",
  };
}

function mapAdminBookingDetail(booking) {
  const course = booking.course && typeof booking.course === "object" ? booking.course : null;
  const variantMetadata = buildBookingChecklistVariantMetadata(booking);
  const bookingDetail = mapBookingDetail(booking, { includeUser: true, includeAdminActions: true });
  const candidateSignature = bookingDetail.candidateSignature || buildCandidateSignatureImagePayload();
  const trainingProviderSignature =
    bookingDetail.trainingProviderSignature || buildTrainingProviderSignaturePayload();

  return {
    ...bookingDetail,
    candidateSignatureImageUrl: candidateSignature.imageUrl || null,
    trainingProviderSignatureImageUrl: trainingProviderSignature.imageUrl || null,
    signatureImages: {
      candidate: {
        url: candidateSignature.url || candidateSignature.imageUrl || null,
        imageUrl: candidateSignature.imageUrl || null,
        signatureImageUrl: candidateSignature.signatureImageUrl || candidateSignature.imageUrl || null,
        previewUrl: candidateSignature.previewUrl || null,
        available: Boolean(candidateSignature.available),
        date: candidateSignature.date || formatDateOnly(candidateSignature.signedAt),
        dateValue: candidateSignature.dateValue || formatDateOnly(candidateSignature.signedAt),
        dateLabel: candidateSignature.dateLabel || formatDisplayDateShort(candidateSignature.signedAt),
      },
      trainingProvider: {
        url: trainingProviderSignature.url || trainingProviderSignature.imageUrl || null,
        imageUrl: trainingProviderSignature.imageUrl || null,
        signatureImageUrl:
          trainingProviderSignature.signatureImageUrl || trainingProviderSignature.imageUrl || null,
        previewUrl: trainingProviderSignature.previewUrl || null,
        available: Boolean(trainingProviderSignature.available),
        date: trainingProviderSignature.date || formatDateOnly(trainingProviderSignature.signedAt),
        dateValue: trainingProviderSignature.dateValue || formatDateOnly(trainingProviderSignature.signedAt),
        dateLabel:
          trainingProviderSignature.dateLabel ||
          formatDisplayDateShort(trainingProviderSignature.signedAt),
      },
    },
    breadcrumbs: [
      {
        label: "Dashboard",
        url: "/admin/dashboard",
      },
      {
        label: "Bookings",
        url: "/admin/bookings",
      },
      {
        label: booking.bookingNumber,
        url: `/admin/bookings/${booking._id}`,
      },
    ],
    profile: buildAdminBookingProfile(booking),
    verification: buildBookingVerification(booking),
    documents: buildAdminBookingDocumentsPayload(booking),
    uploadedDocuments: buildBookingDocuments(booking),
    reviewDecision: buildBookingReviewDecision(booking),
    checklistSummary: buildBookingChecklistSummary(booking, course),
    checklistResponses: buildChecklistResponsesForClient(booking),
    checklistVariantMetadata: variantMetadata,
    checklistFlow: buildBookingChecklistFlowResponse(booking),
    pdfExport: variantMetadata.pdfExport,
  };
}

function buildCheckoutDetailsScreen(booking) {
  const coursePricing = buildBookingCoursePricing(booking);

  return {
    steps: buildCheckoutSteps("details"),
    title: "Personal Details",
    description: "Please provide your details for the booking.",
    booking: {
      id: booking._id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
    },
    course: {
      id: booking.course?._id || booking.course,
      title: booking.courseSnapshot?.title || "",
      slug: booking.courseSnapshot?.slug || "",
      price: coursePricing.totalAmount,
      basePrice: coursePricing.amount,
      currency: booking.payment?.currency || booking.courseSnapshot?.currency || "GBP",
      displayPrice: coursePricing.displayPrice,
      pricing: coursePricing,
    },
    sections: [
      {
        id: "personal-details",
        title: "Personal Details",
        fields: [
          { id: "fullName", label: "Full Name", type: "text", value: booking.personalDetails?.fullName || "", required: true },
          { id: "email", label: "Email Address", type: "email", value: booking.personalDetails?.email || "", required: true },
          { id: "phoneNumber", label: "Phone Number", type: "tel", value: booking.personalDetails?.phoneNumber || "", required: true },
          { id: "dateOfBirth", label: "Date of Birth", type: "date", value: formatDateOnly(booking.personalDetails?.dateOfBirth), required: true },
          { id: "address", label: "Address", type: "text", value: booking.personalDetails?.address || "", required: true },
          { id: "trainingCenter", label: "Location", type: "text", value: booking.personalDetails?.trainingCenter || "", required: true },
          { id: "city", label: "City", type: "text", value: booking.personalDetails?.city || "", required: true },
          { id: "postcode", label: "Postcode", type: "text", value: booking.personalDetails?.postcode || "", required: true },
        ],
      },
    ],
    actions: {
      cancel: {
        label: "Cancel",
        url: `/bookings/${booking._id}`,
      },
      continue: {
        label: "Continue",
        method: "PATCH",
        apiUrl: `/api/bookings/${booking._id}/details`,
        nextApiUrl: `/api/bookings/${booking._id}/checkout/payment`,
      },
    },
  };
}

function buildPaymentScreen(booking) {
  const paymentStatus = booking.payment?.status || "pending";
  const isPaid = paymentStatus === "paid";
  const isApproved = booking.applicationStatus === "approved";
  const useBookingFlowSteps = isAm2BookingFlow(booking);
  const coursePricing = buildBookingCoursePricing(booking);

  return {
    steps: useBookingFlowSteps ? buildBookingFlowSteps("payment") : buildCheckoutSteps("payment"),
    title: "Complete Payment",
    description: isApproved
      ? "Your application is approved. Complete payment to secure your place."
      : "Your application is still under review. Payment will be enabled after approval.",
    alerts: [
      {
        id: "approval",
        tone: isApproved ? "success" : "warning",
        message: isApproved
          ? "Admin approved. Your documents, checklist, and signatures have been verified."
          : "Waiting for admin review and approval before payment can begin.",
      },
      {
        id: "secure-payment",
        tone: "success",
        message: "Secure encrypted payment powered by Stripe.",
      },
    ],
    booking: {
      id: booking._id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus,
    },
    summary: {
      title: booking.courseSnapshot?.title || "Selected Course",
      subtitle: "Billed once",
      amount: booking.payment?.amount ?? 0,
      currency: booking.payment?.currency || "GBP",
      displayAmount: formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP"),
      pricing: coursePricing,
    },
    terms: {
      required: true,
      checkboxLabel:
        "I agree to the Terms and Conditions and Privacy Policy, and consent to share my information with the training provider.",
      accepted: Boolean(booking.payment?.agreedToTerms),
    },
    stripe: {
      enabled: isStripeConfigured(),
      publishableKey: getStripePublishableKey(),
      paymentIntentId: booking.payment?.stripePaymentIntentId || "",
      paymentIntentStatus: booking.payment?.stripePaymentIntentStatus || "",
      createIntentApiUrl: `/api/bookings/${booking._id}/payment/intent`,
      syncPaymentApiUrl: `/api/bookings/${booking._id}/payment`,
      statusApiUrl: `/api/bookings/${booking._id}/payment/status`,
      mode: "card",
    },
    actions: {
      back: {
        label: "Back",
        apiUrl: `/api/bookings/${booking._id}/checkout/details`,
      },
      pay: {
        label: isPaid
          ? `Paid ${formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP")}`
          : `Pay ${formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP")}`,
        enabled: !isPaid && isApproved,
      },
    },
  };
}

function buildConfirmationScreen(booking) {
  const isConfirmed = booking.status === "confirmed" && booking.payment?.status === "paid";
  const useBookingFlowSteps = isAm2BookingFlow(booking);

  return {
    steps: useBookingFlowSteps ? buildBookingFlowSteps("confirmed") : buildCheckoutSteps("confirm"),
    title: isConfirmed ? "Booking Confirmed!" : "Payment Pending",
    description: isConfirmed
      ? "Your payment was successful and your place is secured."
      : "We are still waiting for payment confirmation from Stripe.",
    booking: {
      id: booking._id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus: booking.payment?.status || "pending",
      confirmedAt: booking.confirmedAt || null,
    },
    confirmation: {
      courseTitle: booking.courseSnapshot?.title || "",
      assignedDate: formatDisplayDate(booking.confirmedAt || booking.payment?.paidAt || booking.createdAt),
      time: formatDisplayTime(booking.confirmedAt || booking.payment?.paidAt || booking.createdAt),
      location: booking.session?.location || booking.courseSnapshot?.location || "",
      amountPaid: formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP"),
      reference: booking.bookingNumber,
    },
    receipt: {
      transactionId: booking.payment?.transactionId || "",
      amount: booking.payment?.amount ?? 0,
      currency: booking.payment?.currency || "GBP",
      displayAmount: formatDisplayPrice(booking.payment?.amount ?? 0, booking.payment?.currency || "GBP"),
      cardBrand: booking.payment?.cardBrand || "",
      cardLast4: booking.payment?.cardLast4 || "",
      paidAt: booking.payment?.paidAt || null,
    },
    actions: {
      primary: isConfirmed
        ? {
            label: "View My Bookings",
            apiUrl: `/api/bookings`,
          }
        : {
            label: "Check Payment Status",
            apiUrl: `/api/bookings/${booking._id}/payment/status`,
          },
      secondary: isConfirmed
        ? {
            label: "Back to Dashboard",
            apiUrl: `/api/bookings/dashboard`,
          }
        : null,
    },
  };
}

async function findBookingForUser(id, userId) {
  if (!mongoose.isValidObjectId(id)) {
    return { error: "Invalid booking id", status: 400 };
  }

  const booking = await Booking.findOne(getBookingQueryForUser(id, userId)).populate(
    "course",
    "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections thumbnailUrl"
  );

  if (!booking) {
    return { error: "Booking not found", status: 404 };
  }

  return { value: booking };
}

async function findBookingForSignatureActor(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    return { error: "Invalid booking id", status: 400 };
  }

  const query = {
    _id: id,
  };

  if (user?.role !== "admin") {
    query.user = user?.id;
  }

  const booking = await Booking.findOne(query).populate(
    "course",
    "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections thumbnailUrl"
  );

  if (!booking) {
    return { error: "Booking not found", status: 404 };
  }

  return { value: booking };
}

async function findLatestPendingBookingForUser(userId) {
  return Booking.findOne({
    user: userId,
    status: "pending_payment",
  }).sort({ updatedAt: -1, createdAt: -1 });
}

async function findRegistrationBookingForUser(id, userId) {
  const directResult = await findBookingForUser(id, userId);

  if (!directResult.error) {
    return directResult;
  }

  // Registration saves are often called from Postman with a stale or unset bookingId.
  // In that case, fall back to the user's latest in-progress booking so the flow can continue.
  if (directResult.status === 400 || directResult.status === 404) {
    const fallbackBooking = await findLatestPendingBookingForUser(userId);

    if (fallbackBooking) {
      return {
        value: fallbackBooking,
        fallbackUsed: true,
      };
    }
  }

  return directResult;
}

async function findBookingByTrainingProviderToken(token) {
  const normalizedToken = normalizeString(token);

  if (!normalizedToken) {
    return { error: "Invalid signature token", status: 400 };
  }

  const booking = await Booking.findOne({
    "trainingProviderSignatureRequest.token": normalizedToken,
  }).populate("course", "title slug");

  if (!booking) {
    return { error: "Signature request not found", status: 404 };
  }

  const expiresAt = booking.trainingProviderSignatureRequest?.expiresAt
    ? new Date(booking.trainingProviderSignatureRequest.expiresAt)
    : null;

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { error: "Signature request has expired", status: 410 };
  }

  return { value: booking };
}

function hasRegistrationValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).some((entry) => normalizeString(entry) !== "");
}

function buildRegistrationEndpoints(bookingId) {
  return {
    eligibility: {
      method: "POST",
      apiUrl: `/api/bookings/${bookingId}/registration/eligibility`,
    },
    assessment: {
      method: "POST",
      apiUrl: `/api/bookings/${bookingId}/registration/assessment`,
    },
    employer: {
      method: "POST",
      apiUrl: `/api/bookings/${bookingId}/registration/employer`,
    },
    training: {
      method: "POST",
      apiUrl: `/api/bookings/${bookingId}/registration/training`,
    },
    privacy: {
      method: "POST",
      apiUrl: `/api/bookings/${bookingId}/registration/privacy`,
    },
  };
}

function buildRegistrationProgress(booking) {
  const completed = {
    eligibility: hasRegistrationValue(booking.eligibilityCheck),
    candidate: hasRegistrationValue(booking.personalDetails),
    assessment: hasRegistrationValue(booking.assessmentDetails),
    employer: hasRegistrationValue(booking.employerDetails),
    training: hasRegistrationValue(booking.trainingProviderDetails),
    privacy: Boolean(booking.privacyConfirmation),
  };

  const stepOrder = ["eligibility", "candidate", "assessment", "employer", "training", "privacy"];
  const nextPendingStep = stepOrder.find((step) => !completed[step]) || null;

  return {
    completed,
    nextPendingStep,
    isComplete: stepOrder.every((step) => completed[step]),
  };
}

function applyRegistrationPayloadToBooking(booking, payload) {
  if (payload.eligibilityCheck) {
    booking.eligibilityCheck = {
      ...(booking.eligibilityCheck?.toObject ? booking.eligibilityCheck.toObject() : {}),
      ...payload.eligibilityCheck,
    };
  }

  if (payload.assessmentDetails) {
    booking.assessmentDetails = {
      ...(booking.assessmentDetails?.toObject ? booking.assessmentDetails.toObject() : {}),
      ...payload.assessmentDetails,
    };
  }

  if (payload.employerDetails) {
    booking.employerDetails = {
      ...(booking.employerDetails?.toObject ? booking.employerDetails.toObject() : {}),
      ...payload.employerDetails,
    };
  }

  if (payload.trainingProviderDetails) {
    booking.trainingProviderDetails = {
      ...(booking.trainingProviderDetails?.toObject ? booking.trainingProviderDetails.toObject() : {}),
      ...payload.trainingProviderDetails,
    };
  }

  if (Object.prototype.hasOwnProperty.call(payload, "privacyConfirmation")) {
    booking.privacyConfirmation = Boolean(payload.privacyConfirmation);
    booking.privacyConfirmedAt = payload.privacyConfirmation ? new Date() : null;
  }
}

async function createBooking(req, res, next) {
  try {
    const requestBody = req.body || {};
    const courseResult = await findBookableCourse(req.body || {});
    if (courseResult.error) {
      return res.status(courseResult.status || 400).json({
        success: false,
        message: courseResult.error,
      });
    }

    const personalDetailsResult = buildPersonalDetails(getPersonalDetailsInput(req.body || {}));
    if (personalDetailsResult.error) {
      return res.status(400).json({
        success: false,
        message: personalDetailsResult.error,
      });
    }

    const registrationPayload = {};

    if (requestBody.eligibilityCheck) {
      const eligibilityResult = buildEligibilityCheck(requestBody.eligibilityCheck);
      if (eligibilityResult.error) {
        return res.status(400).json({
          success: false,
          message: eligibilityResult.error,
        });
      }

      registrationPayload.eligibilityCheck = eligibilityResult.value;
    }

    if (requestBody.assessmentDetails) {
      const assessmentResult = buildAssessmentDetails(requestBody.assessmentDetails);
      if (assessmentResult.error) {
        return res.status(400).json({
          success: false,
          message: assessmentResult.error,
        });
      }

      registrationPayload.assessmentDetails = assessmentResult.value;
    }

    if (requestBody.employerDetails) {
      const employerResult = buildOrganizationDetails(requestBody.employerDetails, "Employer");
      if (employerResult.error) {
        return res.status(400).json({
          success: false,
          message: employerResult.error,
        });
      }

      registrationPayload.employerDetails = employerResult.value;
    }

    if (requestBody.trainingProviderDetails) {
      const trainingProviderResult = buildOrganizationDetails(
        requestBody.trainingProviderDetails,
        "Training provider"
      );
      if (trainingProviderResult.error) {
        return res.status(400).json({
          success: false,
          message: trainingProviderResult.error,
        });
      }

      registrationPayload.trainingProviderDetails = trainingProviderResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(requestBody, "privacyConfirmation")) {
      const privacyResult = buildPrivacyConfirmation(requestBody);
      if (privacyResult.error) {
        return res.status(400).json({
          success: false,
          message: privacyResult.error,
        });
      }

      registrationPayload.privacyConfirmation = privacyResult.value.privacyConfirmation;
    }

    const course = courseResult.value;
    const bookingVariantResult = resolveBookingAssessmentVariant(course, requestBody, registrationPayload);
    if (bookingVariantResult.error) {
      return res.status(400).json({
        success: false,
        message: bookingVariantResult.error,
      });
    }

    const courseSnapshot = buildCourseSnapshot(course, bookingVariantResult.variant);
    const sessionResult = buildSessionPayload(req.body || {}, {
      fallbackLocation: course.location || "",
    });
    if (sessionResult.error) {
      return res.status(400).json({
        success: false,
        message: sessionResult.error,
      });
    }

    const existingPendingBooking = await Booking.findOne({
      user: req.user.id,
      course: course._id,
      "courseSnapshot.assessmentVariant": bookingVariantResult.variant,
      status: "pending_payment",
      "payment.status": { $in: ["pending", "failed"] },
    }).sort({ createdAt: -1 });

    if (existingPendingBooking) {
      existingPendingBooking.personalDetails = personalDetailsResult.value;
      existingPendingBooking.courseSnapshot = courseSnapshot;
      existingPendingBooking.session = {
        ...(existingPendingBooking.session?.toObject ? existingPendingBooking.session.toObject() : {}),
        ...sessionResult.value,
      };
      applyRegistrationPayloadToBooking(existingPendingBooking, registrationPayload);
      existingPendingBooking.payment.status = "pending";
      existingPendingBooking.payment.amount = courseSnapshot.totalPrice ?? courseSnapshot.price;
      existingPendingBooking.payment.currency = courseSnapshot.currency;
      existingPendingBooking.payment.failureReason = "";
      existingPendingBooking.payment.method = "stripe";
      await existingPendingBooking.save();

      return res.status(200).json({
        success: true,
        message: "Pending booking updated successfully",
        data: {
          booking: mapBookingDetail(existingPendingBooking),
        },
      });
    }

    const booking = await Booking.create({
      bookingNumber: await ensureUniqueBookingNumber(),
      user: req.user.id,
      course: course._id,
      courseSnapshot,
      personalDetails: personalDetailsResult.value,
      eligibilityCheck: registrationPayload.eligibilityCheck || {},
      assessmentDetails: registrationPayload.assessmentDetails || {},
      employerDetails: registrationPayload.employerDetails || {},
      trainingProviderDetails: registrationPayload.trainingProviderDetails || {},
      privacyConfirmation: Boolean(registrationPayload.privacyConfirmation),
      privacyConfirmedAt: registrationPayload.privacyConfirmation ? new Date() : null,
      status: "pending_payment",
      payment: {
        status: "pending",
        amount: courseSnapshot.totalPrice ?? courseSnapshot.price,
        currency: courseSnapshot.currency,
        agreedToTerms: false,
        method: "stripe",
      },
      session: sessionResult.value,
    });

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: {
        booking: mapBookingDetail(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyDashboard(req, res, next) {
  try {
    const now = new Date();
    const bookings = await Booking.find({
      user: req.user.id,
    })
      .populate(
        "course",
        "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections thumbnailUrl"
      )
      .sort({ "session.startDateTime": 1, createdAt: -1 })
      .limit(25);

    const activeBookings = bookings.filter((booking) => getBookingTab(booking, now) === "upcoming");
    const runningBooking = activeBookings[0] || null;
    const upcomingBooking = activeBookings.length > 1 ? activeBookings[1] : null;
    const activityItems = buildUserDashboardActivityFeed(req.user, bookings);

    return res.status(200).json({
      success: true,
      message: "User dashboard data fetched successfully",
      data: {
        dashboard: {
          welcome: buildUserDashboardWelcome(
            req.user,
            runningBooking ? mapUserDashboardBooking(runningBooking) : null,
            upcomingBooking ? mapUpcomingDashboardBooking(upcomingBooking) : null
          ),
          runningCourse: {
            title: "Running Course",
            booking: runningBooking ? mapUserDashboardBooking(runningBooking) : null,
            emptyState: runningBooking
              ? null
              : {
                  title: "No Active Course.",
                  description: "Book your next training to start tracking your course readiness.",
                  cta: {
                    label: "Browse Courses",
                    url: "/courses",
                  },
                },
          },
          upcomingCourse: {
            title: "Upcoming Course",
            booking: upcomingBooking ? mapUpcomingDashboardBooking(upcomingBooking) : null,
            emptyState: upcomingBooking ? null : buildBookingEmptyState("upcoming"),
          },
          recentActivity: {
            title: "Recent Activity",
            items: activityItems,
            emptyState: activityItems.length
              ? null
              : {
                  title: "No activity yet.",
                  description: "Your course registrations and payment updates will appear here.",
                },
          },
          summary: {
            totalBookings: bookings.length,
            activeBookings: activeBookings.length,
            completedBookings: bookings.filter((booking) => getBookingTab(booking, now) === "past").length,
            cancelledBookings: bookings.filter((booking) => getBookingTab(booking, now) === "cancelled").length,
          },
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listMyBookings(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query || {});
    const now = new Date();
    const activeTab = normalizeString(req.query.tab).toLowerCase() || "upcoming";
    const status = normalizeString(req.query.status).toLowerCase();

    if (!BOOKING_TABS.includes(activeTab)) {
      return res.status(400).json({
        success: false,
        message: "tab must be upcoming, past, or cancelled",
      });
    }

    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status filter must be pending_payment, confirmed, or cancelled",
        });
      }
    }

    const baseFilter = {
      user: req.user.id,
    };
    const filter = {
      ...baseFilter,
      ...buildBookingTabFilter(activeTab, now),
    };

    if (status) {
      filter.status = status;
    }

    const [upcomingCount, pastCount, cancelledCount, bookings, total] = await Promise.all([
      Booking.countDocuments({
        ...baseFilter,
        ...buildBookingTabFilter("upcoming", now),
      }),
      Booking.countDocuments({
        ...baseFilter,
        ...buildBookingTabFilter("past", now),
      }),
      Booking.countDocuments({
        ...baseFilter,
        ...buildBookingTabFilter("cancelled", now),
      }),
      Booking.find(filter)
        .sort(getBookingSort(activeTab))
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    const counts = {
      upcoming: upcomingCount,
      past: pastCount,
      cancelled: cancelledCount,
    };

    return res.status(200).json({
      success: true,
      message: "Bookings fetched successfully",
      data: {
        bookings: bookings.map((booking) => mapBookingSummary(booking)),
        tabs: {
          active: activeTab,
          counts,
        },
        emptyState: bookings.length === 0 ? buildBookingEmptyState(activeTab) : null,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking id",
      });
    }

    const booking = await Booking.findOne(getBookingQueryForUser(id, req.user.id));

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking fetched successfully",
      data: {
        booking: mapBookingDetail(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingDocumentsScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking documents screen fetched successfully",
      data: {
        screen: buildBookingFlowDocumentsScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function uploadMyBookingDocument(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    if (!req.uploadedDocument) {
      return res.status(400).json({
        success: false,
        message: "A document file is required",
      });
    }

    const booking = bookingResult.value;
    const requirementResult = resolveDocumentRequirementForUpload(
      booking,
      getRequestedDocumentType(req.body)
    );

    if (requirementResult.error) {
      return res.status(requirementResult.status).json({
        success: false,
        message: requirementResult.error,
        data: {
          validDocumentTypes: requirementResult.requirements.map((requirement) => ({
            id: requirement.id,
            title: requirement.title,
          })),
        },
      });
    }

    const documentType = requirementResult.requirement.id;
    const documentLabel =
      normalizeString(req.body.documentLabel) ||
      requirementResult.requirement.title;
    const documentTypeKey = normalizeDocumentTypeKey(documentType);
    const existingDocuments = Array.isArray(booking.documents)
      ? booking.documents.filter(
          (document) => normalizeDocumentTypeKey(document.type) !== documentTypeKey
        )
      : [];
    const uploadedDocument = {
      type: documentType,
      label: documentLabel,
      fileName: req.uploadedDocument.fileName,
      fileUrl: req.uploadedDocument.fileUrl,
      mimeType: req.uploadedDocument.mimeType,
      uploadedAt: new Date(),
    };

    booking.documents = [
      ...existingDocuments,
      uploadedDocument,
    ];

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Booking document uploaded successfully",
      data: {
        document: mapUploadedBookingDocument(uploadedDocument, documentType),
        screen: buildBookingFlowDocumentsScreen(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingChecklistScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking checklist screen fetched successfully",
      data: {
        screen: buildBookingFlowChecklistSummaryScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingChecklistFullScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking full checklist fetched successfully",
      data: {
        screen: buildBookingFlowChecklistFullScreen(
          bookingResult.value,
          normalizeString(req.query.section || "A1")
        ),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingChecklist(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const rawResponses = collectChecklistPayloadResponses(req.body);
    if (rawResponses.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Checklist payload must include responses, items, activeSection.items, sections[].items, or checklistSections[].items",
      });
    }

    const checklistLookups = buildChecklistTemplateLookups(
      getChecklistVariantForBooking(bookingResult.value)
    );

    const normalizedResponses = rawResponses
      .map((response) => ({
        itemId: resolveChecklistResponseItemId(response, checklistLookups),
        knowledgeLevel:
          extractChecklistLevel(response?.knowledgeLevel) ||
          extractChecklistLevel(response?.knowledge) ||
          extractChecklistLevel(response?.knowledgeOption),
        experienceLevel:
          extractChecklistLevel(response?.experienceLevel) ||
          extractChecklistLevel(response?.experience) ||
          extractChecklistLevel(response?.experienceOption),
      }))
      .filter(
        (response) =>
          response.itemId &&
          checklistLookups.validItemIds.has(response.itemId) &&
          (response.knowledgeLevel || response.experienceLevel)
      );

    const mergedResponseMap = new Map(
      (Array.isArray(bookingResult.value.checklistResponses)
        ? bookingResult.value.checklistResponses
        : []
      ).map((response) => [response.itemId, response])
    );

    normalizedResponses.forEach((response) => {
      const existingResponse = mergedResponseMap.get(response.itemId) || {
        itemId: response.itemId,
        knowledgeLevel: "",
        experienceLevel: "",
      };
      const mergedResponse = {
        itemId: response.itemId,
        knowledgeLevel: response.knowledgeLevel || existingResponse.knowledgeLevel || "",
        experienceLevel: response.experienceLevel || existingResponse.experienceLevel || "",
      };

      if (mergedResponse.knowledgeLevel || mergedResponse.experienceLevel) {
        mergedResponseMap.set(response.itemId, mergedResponse);
      } else {
        mergedResponseMap.delete(response.itemId);
      }
    });

    bookingResult.value.checklistResponses = Array.from(mergedResponseMap.values());
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Booking checklist saved successfully",
      data: {
        screen: buildBookingFlowChecklistFullScreen(
          bookingResult.value,
          normalizeString(req.query.section || req.body.section || "A1")
        ),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingSignaturesScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking signatures screen fetched successfully",
      data: {
        screen: buildBookingFlowSignaturesScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingSubmitScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking submit screen fetched successfully",
      data: {
        screen: buildBookingFlowSubmitScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function submitMyBookingFlow(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const previousApplicationStatus = bookingResult.value.applicationStatus || "draft";
    bookingResult.value.applicationStatus = "submitted";
    bookingResult.value.submittedAt = bookingResult.value.submittedAt || new Date();
    await bookingResult.value.save();

    if (previousApplicationStatus !== "submitted") {
      await notifyAdminsOfBookingSubmission(bookingResult.value, req.user);
    }

    return res.status(200).json({
      success: true,
      message: "Booking submitted for review successfully",
      data: {
        screen: buildBookingFlowReviewScreen(bookingResult.value),
        booking: mapBookingDetail(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingReviewScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking review screen fetched successfully",
      data: {
        screen: buildBookingFlowReviewScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getTrainingProviderSignatureByToken(req, res, next) {
  try {
    const bookingResult = await findBookingByTrainingProviderToken(req.params.token);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Training provider signature screen fetched successfully",
      data: {
        screen: buildTrainingProviderSignatureScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function submitTrainingProviderSignatureByToken(req, res, next) {
  try {
    const bookingResult = await findBookingByTrainingProviderToken(req.params.token);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const request = bookingResult.value.trainingProviderSignatureRequest || {};
    const existingSignature = bookingResult.value.trainingProviderSignature || {};

    if (
      existingSignature.status === "signed" &&
      normalizeString(existingSignature.signatureData)
    ) {
      return res.status(200).json({
        success: true,
        message: "Training provider signature already submitted",
        data: {
          booking: mapBookingDetail(bookingResult.value),
          screen: buildTrainingProviderSignatureScreen(bookingResult.value),
        },
      });
    }

    const signatureResult = buildSignaturePayload({
      ...(req.body || {}),
      signatureData: req.uploadedSignatureFile?.fileUrl || req.body?.signatureData,
      fileUrl: req.uploadedSignatureFile?.fileUrl || req.body?.fileUrl,
      fileName: req.uploadedSignatureFile?.fileName || req.body?.fileName,
      signatureType:
        req.body?.signatureType ||
        req.body?.type ||
        (req.uploadedSignatureFile ? "upload" : undefined),
      signerName: req.body?.signerName || req.body?.name || request.name || "",
      signerEmail: req.body?.signerEmail || req.body?.email || request.email || "",
    });
    if (signatureResult.error) {
      return res.status(400).json({
        success: false,
        message: signatureResult.error,
      });
    }

    bookingResult.value.trainingProviderSignature = {
      ...(bookingResult.value.trainingProviderSignature?.toObject
        ? bookingResult.value.trainingProviderSignature.toObject()
        : {}),
      status: "signed",
      signerName: signatureResult.value.signerName || request.name || "",
      signerEmail: signatureResult.value.signerEmail || request.email || "",
      signatureType: signatureResult.value.signatureType || "",
      signatureData: signatureResult.value.signatureData,
      fileName: signatureResult.value.fileName,
      signedAt: new Date(),
    };
    bookingResult.value.trainingProviderSignatureRequest = {
      ...(request.toObject ? request.toObject() : request),
      token: request.token || normalizeString(req.params.token),
    };

    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Training provider signature submitted successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
        screen: buildTrainingProviderSignatureScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingCheckoutDetailsScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking checkout details screen fetched successfully",
      data: {
        screen: buildCheckoutDetailsScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingPaymentScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking payment screen fetched successfully",
      data: {
        screen: buildPaymentScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createMyBookingPaymentIntent(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    if (!isStripeConfigured()) {
      return res.status(500).json({
        success: false,
        message: "Stripe is not configured on the server",
      });
    }

    const booking = bookingResult.value;

    if (booking.status === "cancelled") {
      return res.status(409).json({
        success: false,
        message: "Cancelled bookings cannot be paid",
      });
    }

    if (booking.payment?.status === "paid") {
      return res.status(409).json({
        success: false,
        message: "This booking has already been paid",
      });
    }

    if (booking.applicationStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message: "This booking must be approved before payment can begin",
      });
    }

    const agreedToTerms = normalizeBoolean(req.body?.agreedToTerms, false);

    if (!agreedToTerms) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the terms and privacy policy before payment",
      });
    }

    booking.payment.agreedToTerms = true;
    await booking.save();

    const paymentIntent = await createOrReuseStripePaymentIntentForBooking(booking);

    return res.status(200).json({
      success: true,
      message: "Stripe payment intent prepared successfully",
      data: {
        paymentIntent: {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          status: paymentIntent.status,
          amount: booking.payment.amount,
          currency: booking.payment.currency,
        },
        stripe: {
          publishableKey: getStripePublishableKey(),
        },
        booking: mapBookingDetail(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingPaymentStatus(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const booking = bookingResult.value;
    const paymentIntentId = normalizeString(booking.payment?.stripePaymentIntentId);

    if (!paymentIntentId) {
      return res.status(200).json({
        success: true,
        message: "Booking payment status fetched successfully",
        data: {
          booking: mapBookingDetail(booking),
          confirmation: buildConfirmationScreen(booking),
        },
      });
    }

    const syncResult = await syncBookingPaymentWithStripeByIntentId(paymentIntentId);

    if (!syncResult.booking || String(syncResult.booking.user) !== String(req.user.id)) {
      return res.status(404).json({
        success: false,
        message: "Booking not found for this payment",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking payment status fetched successfully",
      data: {
        booking: mapBookingDetail(syncResult.booking),
        paymentIntent: {
          id: syncResult.paymentIntent.id,
          status: syncResult.paymentIntent.status,
        },
        confirmation: buildConfirmationScreen(syncResult.booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookingConfirmationScreen(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking confirmation screen fetched successfully",
      data: {
        screen: buildConfirmationScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMockRegistrationData(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId is required",
      });
    }

    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const course = courseResult.course;

    return res.status(200).json({
      success: true,
      message: "Registration flow data fetched successfully",
      data: {
        course: {
          id: String(course._id),
          title: course.title || "",
          slug: course.slug || "",
          qualification: course.qualification || "",
          location: course.location || "",
          schedule: course.schedule || "",
          duration: course.duration || "",
          price: course.price || 0,
          currency: course.currency || "GBP",
          thumbnailUrl: course.thumbnailUrl || course.galleryImages?.[0] || "",
          galleryImages: course.galleryImages || [],
        },
        eligibility: {
          apiUrl: `/api/courses/${course.slug}/book-now`,
        },
        registrationFlow: {
          candidate: buildCandidateRegistrationForm(course),
          assessment: buildAssessmentRegistrationForm(course),
          employer: buildEmployerRegistrationForm(course),
          training: buildTrainingRegistrationForm(course),
          privacy: buildPrivacyRegistrationForm(course),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAm2ChecklistFlowByCourseId(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const variantResult = resolveChecklistVariantForCourse(courseResult.course, req.query || {}, {
      routeVariant: "am2",
    });
    if (variantResult.error) {
      return res.status(400).json({
        success: false,
        message: variantResult.error,
      });
    }

    const flowResult = await buildChecklistFlowResponseDataForRequest(
      courseResult.course,
      variantResult,
      req
    );
    if (flowResult.error) {
      return res.status(flowResult.status).json({
        success: false,
        message: flowResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "AM2 checklist flow fetched successfully",
      data: flowResult.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getChecklistFlowByCourseId(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const variantResult = resolveChecklistVariantForCourse(courseResult.course, req.query || {});
    if (variantResult.error) {
      return res.status(400).json({
        success: false,
        message: variantResult.error,
      });
    }

    const flowResult = await buildChecklistFlowResponseDataForRequest(
      courseResult.course,
      variantResult,
      req
    );
    if (flowResult.error) {
      return res.status(flowResult.status).json({
        success: false,
        message: flowResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Checklist flow fetched successfully",
      data: flowResult.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getChecklistVariantByCourseId(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const variantResult = resolveChecklistVariantForCourse(courseResult.course, req.query || {});
    if (variantResult.error) {
      return res.status(400).json({
        success: false,
        message: variantResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Checklist variant resolved successfully",
      data: buildChecklistVariantSummary(courseResult.course, variantResult, req.query || {}),
    });
  } catch (error) {
    return next(error);
  }
}

async function getAm2eChecklistFlowByCourseId(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const variantResult = resolveChecklistVariantForCourse(courseResult.course, req.query || {}, {
      routeVariant: "am2e",
    });
    if (variantResult.error) {
      return res.status(400).json({
        success: false,
        message: variantResult.error,
      });
    }

    const flowResult = await buildChecklistFlowResponseDataForRequest(
      courseResult.course,
      variantResult,
      req
    );
    if (flowResult.error) {
      return res.status(flowResult.status).json({
        success: false,
        message: flowResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "AM2E checklist flow fetched successfully",
      data: flowResult.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAm2eV1ChecklistFlowByCourseId(req, res, next) {
  try {
    const courseId = normalizeString(req.query?.courseId);
    const courseResult = await findChecklistCourseById(courseId);
    if (courseResult.error) {
      return res.status(courseResult.status).json({
        success: false,
        message: courseResult.error,
      });
    }

    const variantResult = resolveChecklistVariantForCourse(courseResult.course, req.query || {}, {
      routeVariant: "am2e-v1",
    });
    if (variantResult.error) {
      return res.status(400).json({
        success: false,
        message: variantResult.error,
      });
    }

    const flowResult = await buildChecklistFlowResponseDataForRequest(
      courseResult.course,
      variantResult,
      req
    );
    if (flowResult.error) {
      return res.status(flowResult.status).json({
        success: false,
        message: flowResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "AM2E V1 checklist flow fetched successfully",
      data: flowResult.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function submitMyBookingCandidateSignature(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const signatureResult = buildSignaturePayload({
      ...(req.body || {}),
      signatureData: req.uploadedSignatureFile?.fileUrl || req.body?.signatureData,
      fileUrl: req.uploadedSignatureFile?.fileUrl || req.body?.fileUrl,
      fileName: req.uploadedSignatureFile?.fileName || req.body?.fileName,
      signatureType:
        req.body?.signatureType ||
        req.body?.type ||
        (req.uploadedSignatureFile ? "upload" : undefined),
      signerName: req.body?.signerName || bookingResult.value.personalDetails?.fullName || "",
      signerEmail: req.body?.signerEmail || bookingResult.value.personalDetails?.email || "",
    });
    if (signatureResult.error) {
      return res.status(400).json({
        success: false,
        message: signatureResult.error,
      });
    }

    bookingResult.value.candidateSignature = {
      ...(bookingResult.value.candidateSignature?.toObject
        ? bookingResult.value.candidateSignature.toObject()
        : {}),
      status: "signed",
      signerName: signatureResult.value.signerName,
      signerEmail: signatureResult.value.signerEmail,
      signatureType: signatureResult.value.signatureType || "",
      signatureData: signatureResult.value.signatureData,
      fileName: signatureResult.value.fileName,
      signedAt: new Date(),
    };
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Candidate signature submitted successfully",
      data: {
        screen: buildBookingFlowSignaturesScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function submitMyBookingTrainingProviderSignature(req, res, next) {
  try {
    const bookingResult = await findBookingForSignatureActor(req.params.id, req.user);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const trainingProviderDetails = bookingResult.value.trainingProviderDetails || {};
    const signatureResult = buildSignaturePayload({
      ...(req.body || {}),
      signatureData: req.uploadedSignatureFile?.fileUrl || req.body?.signatureData,
      fileUrl: req.uploadedSignatureFile?.fileUrl || req.body?.fileUrl,
      fileName: req.uploadedSignatureFile?.fileName || req.body?.fileName,
      signatureType:
        req.body?.signatureType ||
        req.body?.type ||
        (req.uploadedSignatureFile ? "upload" : undefined),
      signerName:
        req.body?.signerName ||
        req.body?.name ||
        trainingProviderDetails.contactName ||
        trainingProviderDetails.companyName ||
        "",
      signerEmail: req.body?.signerEmail || req.body?.email || trainingProviderDetails.email || "",
    });
    if (signatureResult.error) {
      return res.status(400).json({
        success: false,
        message: signatureResult.error,
      });
    }

    bookingResult.value.trainingProviderSignature = {
      ...(bookingResult.value.trainingProviderSignature?.toObject
        ? bookingResult.value.trainingProviderSignature.toObject()
        : {}),
      status: "signed",
      signerName: signatureResult.value.signerName,
      signerEmail: signatureResult.value.signerEmail,
      signatureType: signatureResult.value.signatureType || "",
      signatureData: signatureResult.value.signatureData,
      fileName: signatureResult.value.fileName,
      signedAt: new Date(),
    };
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Training provider signature submitted successfully",
      data: {
        trainingProviderSignature: buildTrainingProviderSignaturePayload(
          bookingResult.value.trainingProviderSignature
        ),
        screen: buildBookingFlowSignaturesScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function requestMyBookingTrainingProviderSignature(req, res, next) {
  try {
    const bookingResult = await findBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const requestPayloadResult = buildTrainingProviderSignatureRequestPayload(req.body || {});
    if (requestPayloadResult.error) {
      return res.status(400).json({
        success: false,
        message: requestPayloadResult.error,
      });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const requestPayload = requestPayloadResult.value;
    const signatureLink = getTrainingProviderSignatureLink(token);
    const signatureApiUrl = getTrainingProviderSignatureApiUrl(token);

    bookingResult.value.trainingProviderSignatureRequest = {
      email: requestPayload.email,
      name: requestPayload.name,
      subject: requestPayload.subject,
      message: requestPayload.message,
      token,
      expiresAt,
      lastSentAt: new Date(),
    };
    bookingResult.value.trainingProviderSignature = {
      ...(bookingResult.value.trainingProviderSignature?.toObject
        ? bookingResult.value.trainingProviderSignature.toObject()
        : {}),
      status: "requested",
      signerEmail: requestPayload.email,
      signerName: requestPayload.name,
      requestedAt: new Date(),
      signedAt: null,
    };

    await bookingResult.value.save();

    let emailDelivery = {
      sent: false,
      message: "",
    };

    try {
      await sendTrainingProviderSignatureRequestEmail({
        to: requestPayload.email,
        providerName: requestPayload.name,
        candidateName: bookingResult.value.personalDetails?.fullName || "",
        courseTitle: bookingResult.value.courseSnapshot?.title || "",
        subject: requestPayload.subject,
        message: requestPayload.message,
        signatureLink,
        signatureApiUrl,
        expiresAt,
      });

      emailDelivery = {
        sent: true,
        message: "Email sent successfully",
      };
    } catch (emailError) {
      emailDelivery = {
        sent: false,
        message: getMailDeliveryFailureMessage(emailError),
      };
      console.error("[training-provider-signature-email]", emailError?.message || emailError);
    }

    return res.status(emailDelivery.sent ? 200 : 502).json({
      success: emailDelivery.sent,
      message: emailDelivery.sent
        ? "Training provider signature request sent successfully"
        : "Training provider signature request was saved, but email delivery failed",
      data: {
        requested: true,
        emailSent: emailDelivery.sent,
        emailDelivery,
        email: requestPayload.email,
        link: signatureLink,
        signatureLink,
        signatureApiUrl,
        expiresAt,
        screen: buildBookingFlowSignaturesScreen(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingEligibility(req, res, next) {
  try {
    const bookingResult = await findRegistrationBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const eligibilityResult = buildEligibilityCheck(req.body?.eligibilityCheck || req.body || {});
    if (eligibilityResult.error) {
      return res.status(400).json({
        success: false,
        message: eligibilityResult.error,
      });
    }

    applyRegistrationPayloadToBooking(bookingResult.value, {
      eligibilityCheck: eligibilityResult.value,
    });
    await bookingResult.value.save();

    const nextChecklistFlow = resolveChecklistRouteFromEligibility(bookingResult.value);

    return res.status(200).json({
      success: true,
      message: "Eligibility check saved successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
        nextChecklistFlow,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingAssessmentDetails(req, res, next) {
  try {
    const bookingResult = await findRegistrationBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const assessmentResult = buildAssessmentDetails(req.body?.assessmentDetails || req.body || {});
    if (assessmentResult.error) {
      return res.status(400).json({
        success: false,
        message: assessmentResult.error,
      });
    }

    applyRegistrationPayloadToBooking(bookingResult.value, {
      assessmentDetails: assessmentResult.value,
    });
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Assessment details saved successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingEmployerDetails(req, res, next) {
  try {
    const bookingResult = await findRegistrationBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const employerResult = buildOrganizationDetails(req.body?.employerDetails || req.body || {}, "Employer");
    if (employerResult.error) {
      return res.status(400).json({
        success: false,
        message: employerResult.error,
      });
    }

    applyRegistrationPayloadToBooking(bookingResult.value, {
      employerDetails: employerResult.value,
    });
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Employer details saved successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingTrainingProviderDetails(req, res, next) {
  try {
    const bookingResult = await findRegistrationBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const trainingProviderResult = buildOrganizationDetails(
      req.body?.trainingProviderDetails || req.body || {},
      "Training provider"
    );
    if (trainingProviderResult.error) {
      return res.status(400).json({
        success: false,
        message: trainingProviderResult.error,
      });
    }

    applyRegistrationPayloadToBooking(bookingResult.value, {
      trainingProviderDetails: trainingProviderResult.value,
    });
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Training provider details saved successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMyBookingPrivacyConfirmation(req, res, next) {
  try {
    const bookingResult = await findRegistrationBookingForUser(req.params.id, req.user.id);
    if (bookingResult.error) {
      return res.status(bookingResult.status).json({
        success: false,
        message: bookingResult.error,
      });
    }

    const privacyResult = buildPrivacyConfirmation(req.body || {});
    if (privacyResult.error) {
      return res.status(400).json({
        success: false,
        message: privacyResult.error,
      });
    }

    applyRegistrationPayloadToBooking(bookingResult.value, privacyResult.value);
    await bookingResult.value.save();

    return res.status(200).json({
      success: true,
      message: "Privacy confirmation saved successfully",
      data: {
        booking: mapBookingDetail(bookingResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMyBookingDetails(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking id",
      });
    }

    const booking = await Booking.findOne(getBookingQueryForUser(id, req.user.id));

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (booking.status === "cancelled") {
      return res.status(409).json({
        success: false,
        message: "Cancelled bookings cannot be updated",
      });
    }

    const personalDetailsResult = buildPersonalDetails(getPersonalDetailsInput(req.body || {}), {
      partial: true,
    });
    if (personalDetailsResult.error) {
      return res.status(400).json({
        success: false,
        message: personalDetailsResult.error,
      });
    }

    Object.assign(booking.personalDetails, personalDetailsResult.value);
    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Booking details updated successfully",
      data: {
        booking: mapBookingDetail(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function payForMyBooking(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking id",
      });
    }

    const booking = await Booking.findOne(getBookingQueryForUser(id, req.user.id));

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (booking.status === "cancelled") {
      return res.status(409).json({
        success: false,
        message: "Cancelled bookings cannot be paid",
      });
    }

    if (booking.payment?.status === "paid") {
      return res.status(409).json({
        success: false,
        message: "This booking has already been paid",
      });
    }

    if (booking.applicationStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message: "This booking must be approved before payment can begin",
      });
    }

    if (!isStripeConfigured()) {
      return res.status(500).json({
        success: false,
        message: "Stripe is not configured on the server",
      });
    }

    const agreedToTerms = normalizeBoolean(req.body?.agreedToTerms, booking.payment?.agreedToTerms);

    if (!agreedToTerms) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the terms and privacy policy before payment",
      });
    }

    booking.payment.agreedToTerms = true;
    await booking.save();

    const requestedPaymentIntentId =
      normalizeString(req.body?.paymentIntentId) || normalizeString(booking.payment?.stripePaymentIntentId);
    const paymentMethodId = normalizeString(req.body?.paymentMethodId);

    if (!requestedPaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: "paymentIntentId is required. Create a Stripe payment intent first.",
      });
    }

    let syncResult = await syncBookingPaymentWithStripeByIntentId(requestedPaymentIntentId);

    if (!syncResult.booking || String(syncResult.booking._id) !== String(booking._id)) {
      return res.status(404).json({
        success: false,
        message: "Stripe payment could not be matched to this booking",
      });
    }

    if (
      syncResult.booking.payment?.status !== "paid" &&
      paymentMethodId &&
      [
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
      ].includes(syncResult.paymentIntent?.status)
    ) {
      await confirmStripePaymentIntent(requestedPaymentIntentId, paymentMethodId);
      syncResult = await syncBookingPaymentWithStripeByIntentId(requestedPaymentIntentId);
    }

    if (syncResult.booking.payment?.status !== "paid") {
      return res.status(409).json({
        success: false,
        message:
          syncResult.booking.payment?.failureReason ||
          (syncResult.paymentIntent?.status === "requires_payment_method" ||
          syncResult.paymentIntent?.status === "requires_confirmation"
            ? "Payment has not completed yet. Confirm the PaymentIntent with Stripe.js, or send a Stripe test paymentMethodId such as pm_card_visa to this endpoint."
            : "Payment has not completed yet"),
        data: {
          booking: mapBookingDetail(syncResult.booking),
          paymentIntent: {
            id: syncResult.paymentIntent.id,
            status: syncResult.paymentIntent.status,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment completed successfully",
      data: {
        booking: mapBookingDetail(syncResult.booking),
        receipt: {
          bookingNumber: syncResult.booking.bookingNumber,
          transactionId: syncResult.booking.payment.transactionId,
          amount: syncResult.booking.payment.amount,
          currency: syncResult.booking.payment.currency,
          displayAmount: formatDisplayPrice(syncResult.booking.payment.amount, syncResult.booking.payment.currency),
          paidAt: syncResult.booking.payment.paidAt,
          cardBrand: syncResult.booking.payment.cardBrand,
          cardLast4: syncResult.booking.payment.cardLast4,
        },
        confirmation: buildConfirmationScreen(syncResult.booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listAdminBookings(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query || {});
    const now = new Date();
    const filter = {};

    const activeTab = normalizeString(req.query.tab).toLowerCase();
    const status = normalizeString(req.query.status).toLowerCase();
    const paymentStatus = normalizeString(req.query.paymentStatus).toLowerCase();
    const search = normalizeString(req.query.search);

    if (activeTab && !BOOKING_TABS.includes(activeTab)) {
      return res.status(400).json({
        success: false,
        message: "tab must be upcoming, past, or cancelled",
      });
    }

    if (activeTab) {
      Object.assign(filter, buildBookingTabFilter(activeTab, now));
    }

    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status filter must be pending_payment, confirmed, or cancelled",
        });
      }

      filter.status = status;
    }

    if (paymentStatus) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({
          success: false,
          message: "paymentStatus must be pending, paid, failed, or refunded",
        });
      }

      filter["payment.status"] = paymentStatus;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { bookingNumber: searchRegex },
        { "personalDetails.fullName": searchRegex },
        { "personalDetails.email": searchRegex },
        { "courseSnapshot.title": searchRegex },
      ];
    }

    const [upcomingCount, pastCount, cancelledCount, bookings, total] = await Promise.all([
      Booking.countDocuments(buildBookingTabFilter("upcoming", now)),
      Booking.countDocuments(buildBookingTabFilter("past", now)),
      Booking.countDocuments(buildBookingTabFilter("cancelled", now)),
      Booking.find(filter)
        .populate("user", "name email role")
        .sort(getBookingSort(activeTab || "upcoming"))
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Admin bookings fetched successfully",
      data: {
        bookings: bookings.map((booking) =>
          mapBookingSummary(booking, { includeUser: true, includeAdminActions: true })
        ),
        tabs: {
          active: activeTab || null,
          counts: {
            upcoming: upcomingCount,
            past: pastCount,
            cancelled: cancelledCount,
          },
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminBookingById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking id",
      });
    }

    const booking = await Booking.findById(id)
      .populate("user", "name email role")
      .populate(
        "course",
        "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections"
      );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin booking fetched successfully",
      data: {
        booking: mapAdminBookingDetail(booking),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAdminBooking(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking id",
      });
    }

    const booking = await Booking.findById(id)
      .populate("user", "name email role")
      .populate(
        "course",
        "title slug qualification assessmentVariant sourceCourseName location schedule duration detailSections"
      );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const status = normalizeString(req.body.status).toLowerCase();
    const paymentStatus = normalizeString(req.body.paymentStatus).toLowerCase();
    const applicationStatus = normalizeString(req.body.applicationStatus).toLowerCase();
    const notes = normalizeString(req.body.notes);
    const hasSessionField =
      Object.prototype.hasOwnProperty.call(req.body, "sessionStartDateTime") ||
      Object.prototype.hasOwnProperty.call(req.body, "startDateTime") ||
      Object.prototype.hasOwnProperty.call(req.body, "sessionDateTime") ||
      Object.prototype.hasOwnProperty.call(req.body, "sessionEndDateTime") ||
      Object.prototype.hasOwnProperty.call(req.body, "endDateTime") ||
      Object.prototype.hasOwnProperty.call(req.body, "sessionLocation") ||
      Object.prototype.hasOwnProperty.call(req.body, "location");

    const sessionResult = hasSessionField
      ? buildSessionPayload(req.body || {}, {
          partial: true,
        })
      : { value: null };
    if (sessionResult.error) {
      return res.status(400).json({
        success: false,
        message: sessionResult.error,
      });
    }

    if (
      !status &&
      !paymentStatus &&
      !applicationStatus &&
      !Object.prototype.hasOwnProperty.call(req.body, "notes") &&
      !hasSessionField
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one of status, paymentStatus, applicationStatus, notes, or session fields is required",
      });
    }

    const previousApplicationStatus = booking.applicationStatus || "draft";

    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be pending_payment, confirmed, or cancelled",
        });
      }

      booking.status = status;

      if (status === "confirmed") {
        booking.confirmedAt = booking.confirmedAt || new Date();
        booking.cancelledAt = null;
        booking.applicationStatus = "approved";
        booking.reviewedAt = booking.reviewedAt || new Date();

        if (booking.payment.status !== "paid") {
          booking.payment.status = "paid";
          booking.payment.method = "manual";
          booking.payment.paidAt = booking.payment.paidAt || new Date();
          booking.payment.transactionId = booking.payment.transactionId || createTransactionId();
        }
      }

      if (status === "cancelled") {
        booking.cancelledAt = new Date();
      }

      if (status === "pending_payment") {
        booking.confirmedAt = null;
        booking.cancelledAt = null;
        if (booking.payment.status === "paid") {
          booking.payment.status = "pending";
          booking.payment.paidAt = null;
        }
      }
    }

    if (paymentStatus) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({
          success: false,
          message: "paymentStatus must be pending, paid, failed, or refunded",
        });
      }

      booking.payment.status = paymentStatus;
      booking.payment.failureReason = paymentStatus === "failed" ? booking.payment.failureReason : "";

      if (paymentStatus === "paid") {
        booking.payment.paidAt = booking.payment.paidAt || new Date();
        booking.payment.transactionId = booking.payment.transactionId || createTransactionId();
        booking.payment.method = booking.payment.method || "manual";
        booking.status = "confirmed";
        booking.confirmedAt = booking.confirmedAt || new Date();
        booking.cancelledAt = null;
        booking.applicationStatus = "approved";
        booking.reviewedAt = booking.reviewedAt || new Date();
      }

      if (paymentStatus === "pending") {
        booking.payment.paidAt = null;
        if (booking.status === "confirmed") {
          booking.status = "pending_payment";
          booking.confirmedAt = null;
        }
      }

      if (paymentStatus === "refunded") {
        booking.status = "cancelled";
        booking.cancelledAt = booking.cancelledAt || new Date();
      }
    }

    if (applicationStatus) {
      if (!APPLICATION_STATUSES.includes(applicationStatus)) {
        return res.status(400).json({
          success: false,
          message: "applicationStatus must be draft, submitted, under_review, approved, or rejected",
        });
      }

      booking.applicationStatus = applicationStatus;

      if (applicationStatus === "submitted" || applicationStatus === "under_review") {
        booking.submittedAt = booking.submittedAt || new Date();
      }

      if (applicationStatus === "approved" || applicationStatus === "rejected") {
        booking.reviewedAt = new Date();
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "notes")) {
      if (notes.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Notes must be 500 characters or fewer",
        });
      }

      booking.notes = notes;
    }

    if (hasSessionField) {
      booking.session = {
        ...(booking.session?.toObject ? booking.session.toObject() : {}),
        ...sessionResult.value,
      };
    }

    await booking.save();

    let approvalNotification = {
      created: false,
      count: 0,
    };
    let approvalEmailDelivery = null;
    const nextApplicationStatus = booking.applicationStatus || "draft";
    const explicitAdminApproval =
      applicationStatus === "approved" ||
      status === "confirmed" ||
      (paymentStatus === "paid" && previousApplicationStatus !== "approved");
    if (
      nextApplicationStatus === "approved" &&
      (previousApplicationStatus !== "approved" || explicitAdminApproval)
    ) {
      const createdNotifications = await notifyUserOfBookingApproval(booking, req.user);
      approvalNotification = {
        created: createdNotifications.length > 0,
        count: createdNotifications.length,
        type: booking.payment?.status === "paid" ? "booking_approved" : "paperwork_approved",
      };
      approvalEmailDelivery = await sendBookingApprovalEmailForBooking(booking);
    }

    return res.status(200).json({
      success: true,
      message:
        approvalEmailDelivery && approvalEmailDelivery.attempted && !approvalEmailDelivery.sent
          ? "Booking updated successfully, but approval email delivery failed"
          : "Booking updated successfully",
      data: {
        booking: mapAdminBookingDetail(booking),
        approvalNotification,
        approvalEmailDelivery,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBooking,
  getChecklistFlowByCourseId,
  getChecklistVariantByCourseId,
  getAm2ChecklistFlowByCourseId,
  getAm2eChecklistFlowByCourseId,
  getAm2eV1ChecklistFlowByCourseId,
  getMockRegistrationData,
  getMyDashboard,
  listMyBookings,
  getMyBookingById,
  getMyBookingDocumentsScreen,
  uploadMyBookingDocument,
  getMyBookingChecklistScreen,
  getMyBookingChecklistFullScreen,
  saveMyBookingChecklist,
  getMyBookingSignaturesScreen,
  getMyBookingSubmitScreen,
  submitMyBookingFlow,
  getMyBookingReviewScreen,
  getTrainingProviderSignatureByToken,
  submitTrainingProviderSignatureByToken,
  submitMyBookingCandidateSignature,
  submitMyBookingTrainingProviderSignature,
  requestMyBookingTrainingProviderSignature,
  saveMyBookingEligibility,
  saveMyBookingAssessmentDetails,
  saveMyBookingEmployerDetails,
  saveMyBookingTrainingProviderDetails,
  saveMyBookingPrivacyConfirmation,
  updateMyBookingDetails,
  getMyBookingCheckoutDetailsScreen,
  getMyBookingPaymentScreen,
  createMyBookingPaymentIntent,
  getMyBookingPaymentStatus,
  getMyBookingConfirmationScreen,
  payForMyBooking,
  listAdminBookings,
  getAdminBookingById,
  updateAdminBooking,
};

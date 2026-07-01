const express = require("express");

const {
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
  submitMyBookingCandidateSignature,
  submitMyBookingTrainingProviderSignature,
  requestMyBookingTrainingProviderSignature,
  getTrainingProviderSignatureByToken,
  submitTrainingProviderSignatureByToken,
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
} = require("../controllers/bookingController");
const { optionalAuth, requireAuth } = require("../middleware/authMiddleware");
const {
  uploadBookingDocument,
  uploadBookingSignatureImage,
} = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/provider-signature/:token", getTrainingProviderSignatureByToken);
router.post("/provider-signature/:token", uploadBookingSignatureImage, submitTrainingProviderSignatureByToken);
router.get("/checklist-flow", optionalAuth, getChecklistFlowByCourseId);
router.get("/checklist-variant", optionalAuth, getChecklistVariantByCourseId);
router.get("/am2-checklist-flow", optionalAuth, getAm2ChecklistFlowByCourseId);
router.get("/am2e-checklist-flow", optionalAuth, getAm2eChecklistFlowByCourseId);
router.get("/am2e-v1-checklist-flow", optionalAuth, getAm2eV1ChecklistFlowByCourseId);
router.get("/mock-registration-data", getMockRegistrationData);

router.use(requireAuth);

router.get("/dashboard", getMyDashboard);
router.get("/", listMyBookings);
router.post("/", createBooking);
router.get("/:id/flow/documents", getMyBookingDocumentsScreen);
router.post("/:id/flow/documents/upload", uploadBookingDocument, uploadMyBookingDocument);
router.get("/:id/flow/checklist", getMyBookingChecklistScreen);
router.get("/:id/flow/checklist/full", getMyBookingChecklistFullScreen);
router.patch("/:id/flow/checklist", saveMyBookingChecklist);
router.get("/:id/flow/signatures", getMyBookingSignaturesScreen);
router.post(
  "/:id/flow/signatures/candidate",
  uploadBookingSignatureImage,
  submitMyBookingCandidateSignature
);
router.post(
  "/:id/flow/signatures/training-provider",
  uploadBookingSignatureImage,
  submitMyBookingTrainingProviderSignature
);
router.post("/:id/flow/signatures/training-provider/request", requestMyBookingTrainingProviderSignature);
router.get("/:id/flow/submit", getMyBookingSubmitScreen);
router.post("/:id/flow/submit", submitMyBookingFlow);
router.get("/:id/flow/review", getMyBookingReviewScreen);
router.post("/:id/registration/eligibility", saveMyBookingEligibility);
router.post("/:id/registration/assessment", saveMyBookingAssessmentDetails);
router.post("/:id/registration/employer", saveMyBookingEmployerDetails);
router.post("/:id/registration/training", saveMyBookingTrainingProviderDetails);
router.post("/:id/registration/privacy", saveMyBookingPrivacyConfirmation);
router.get("/:id/checkout/details", getMyBookingCheckoutDetailsScreen);
router.get("/:id/checkout/payment", getMyBookingPaymentScreen);
router.get("/:id/checkout/confirmation", getMyBookingConfirmationScreen);
router.get("/:id", getMyBookingById);
router.patch("/:id/details", updateMyBookingDetails);
router.post("/:id/payment/intent", createMyBookingPaymentIntent);
router.get("/:id/payment/status", getMyBookingPaymentStatus);
router.post("/:id/payment", payForMyBooking);

module.exports = router;

const express = require("express");

const {
  listCourses,
  searchCourses,
  getCourseDetails,
  getCourseCatalogScreen,
  getCourseDetailScreen,
  getCourseBookNowModal,
  getCourseRegistrationForm,
  getCourseAssessmentRegistrationForm,
  getCourseEmployerRegistrationForm,
  getCourseTrainingRegistrationForm,
  getCoursePrivacyRegistrationForm,
} = require("../controllers/courseController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/screen/catalog", getCourseCatalogScreen);
router.get("/search", searchCourses);
router.get("/:slug/screen", getCourseDetailScreen);

router.use(requireAuth);

router.get("/:slug/book-now", getCourseBookNowModal);
router.get("/:slug/registration-form", getCourseRegistrationForm);
router.get("/:slug/registration-form/assessment", getCourseAssessmentRegistrationForm);
router.get("/:slug/registration-form/employer", getCourseEmployerRegistrationForm);
router.get("/:slug/registration-form/training", getCourseTrainingRegistrationForm);
router.get("/:slug/registration-form/privacy", getCoursePrivacyRegistrationForm);
router.get("/", listCourses);
router.get("/:slug", getCourseDetails);

module.exports = router;

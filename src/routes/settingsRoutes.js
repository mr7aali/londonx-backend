const express = require("express");

const {
  getProfileSettingsScreen,
  updateProfileSettings,
  deleteProfilePhoto,
  getNotificationSettingsScreen,
  updateNotificationSettings,
  getSecuritySettingsScreen,
  updatePasswordSettings,
  listLegalPages,
  getPublicFaqPage,
  getFaqSettingsScreen,
  updateFaqPageContent,
  addFaqItem,
  updateFaqItem,
  updateFaqItemVisibility,
  deleteFaqItem,
  getPublicLegalPage,
  getLegalPageSettingsScreen,
  updateLegalPageContent,
  addLegalPageSection,
  updateLegalPageSection,
  updateLegalPageSectionVisibility,
  deleteLegalPageSection,
} = require("../controllers/settingsController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const { uploadUserProfileImage } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/public/legal-pages/:slug", getPublicLegalPage);
router.get("/public/faqs", getPublicFaqPage);
router.get("/legal-pages/:slug", getLegalPageSettingsScreen);
router.get("/faqs", getFaqSettingsScreen);

router.use(requireAuth);

router.get("/profile", getProfileSettingsScreen);
router.patch("/profile", uploadUserProfileImage, updateProfileSettings);
router.delete("/profile/photo", deleteProfilePhoto);
router.get("/notifications", getNotificationSettingsScreen);
router.patch("/notifications", updateNotificationSettings);
router.get("/security", getSecuritySettingsScreen);
router.post("/security/password", updatePasswordSettings);
router.patch("/faqs", requireRole("admin"), updateFaqPageContent);
router.post("/faqs/items", requireRole("admin"), addFaqItem);
router.patch("/faqs/items/:faqId/visibility", requireRole("admin"), updateFaqItemVisibility);
router.patch("/faqs/items/:faqId", requireRole("admin"), updateFaqItem);
router.delete("/faqs/items/:faqId", requireRole("admin"), deleteFaqItem);
router.get("/legal-pages", requireRole("admin"), listLegalPages);
router.patch("/legal-pages/:slug", requireRole("admin"), updateLegalPageContent);
router.post("/legal-pages/:slug/sections", requireRole("admin"), addLegalPageSection);
router.patch(
  "/legal-pages/:slug/sections/:sectionId/visibility",
  requireRole("admin"),
  updateLegalPageSectionVisibility
);
router.patch(
  "/legal-pages/:slug/sections/:sectionId",
  requireRole("admin"),
  updateLegalPageSection
);
router.delete(
  "/legal-pages/:slug/sections/:sectionId",
  requireRole("admin"),
  deleteLegalPageSection
);

module.exports = router;

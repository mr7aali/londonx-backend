const express = require("express");

const {
  getDashboard,
  listUsers,
  listSubmissions,
  listCandidates,
  sendCandidateReminder,
  sendStuckCandidateReminders,
  getCandidateById,
} = require("../controllers/adminController");
const {
  listAdminCourses,
  listCourseSourceOptions,
  createCourse,
  getAdminCourseById,
  getAdminCourseVariantPrices,
  updateAdminCourseVariantPrices,
  updateCourse,
  deleteCourse,
} = require("../controllers/courseController");
const {
  listAdminTeamMembers,
  createTeamMember,
  getAdminTeamMemberById,
  updateTeamMember,
} = require("../controllers/teamController");
const {
  listAdminBookings,
  getAdminBookingById,
  updateAdminBooking,
} = require("../controllers/bookingController");
const {
  getAdminSupportScreen,
  listAdminSupportTickets,
  getAdminSupportTicketById,
  replyToAdminSupportTicket,
  updateAdminSupportTicket,
} = require("../controllers/supportController");
const {
  listAdminContactMessages,
  getAdminContactMessageById,
  updateAdminContactMessage,
} = require("../controllers/contactController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const { uploadCourseImage, uploadTeamImage } = require("../middleware/uploadMiddleware");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin")];

router.get("/courses/options", requireAdmin, listCourseSourceOptions);
router.get("/courses", listAdminCourses);
router.get("/courses/:id/assessment-variant-prices", getAdminCourseVariantPrices);
router.patch("/courses/:id/assessment-variant-prices", updateAdminCourseVariantPrices);
router.get("/courses/:id", getAdminCourseById);
router.patch("/courses/:id", uploadCourseImage, updateCourse);

router.use(requireAdmin);

router.get("/dashboard", getDashboard);
router.get("/users", listUsers);
router.get("/submissions", listSubmissions);
router.get("/candidates", listCandidates);
router.post("/candidates/stuck/reminders", sendStuckCandidateReminders);
router.post("/candidates/:id/reminder", sendCandidateReminder);
router.get("/candidates/:id", getCandidateById);
router.post("/courses", uploadCourseImage, createCourse);
router.delete("/courses/:id", deleteCourse);
router.get("/team", listAdminTeamMembers);
router.post("/team", uploadTeamImage, createTeamMember);
router.get("/team/:id", getAdminTeamMemberById);
router.patch("/team/:id", uploadTeamImage, updateTeamMember);
router.get("/bookings", listAdminBookings);
router.get("/bookings/:id", getAdminBookingById);
router.patch("/bookings/:id", updateAdminBooking);
router.get("/support", getAdminSupportScreen);
router.get("/support/tickets", listAdminSupportTickets);
router.get("/support/tickets/:id", getAdminSupportTicketById);
router.post("/support/tickets/:id/replies", replyToAdminSupportTicket);
router.patch("/support/tickets/:id", updateAdminSupportTicket);
router.get("/contact/messages", listAdminContactMessages);
router.get("/contact/messages/:id", getAdminContactMessageById);
router.patch("/contact/messages/:id", updateAdminContactMessage);

module.exports = router;

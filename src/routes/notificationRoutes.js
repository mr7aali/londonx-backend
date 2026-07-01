const express = require("express");

const {
  getMyNotifications,
  getMyNotificationById,
  markMyNotificationAsRead,
  markAllMyNotificationsAsRead,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/", getMyNotifications);
router.get("/:id", getMyNotificationById);
router.patch("/read-all", markAllMyNotificationsAsRead);
router.patch("/:id/read", markMyNotificationAsRead);

module.exports = router;

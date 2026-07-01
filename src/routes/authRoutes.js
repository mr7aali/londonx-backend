const express = require("express");

const {
  signup,
  login,
  forgotPassword,
  resendPasswordReset,
  resetPassword,
  getMe,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/forgot-password/resend", resendPasswordReset);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, getMe);

module.exports = router;

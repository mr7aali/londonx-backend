const express = require("express");

const {
  getSupportScreen,
  listMySupportTickets,
  createSupportTicket,
  getMySupportTicketById,
  replyToMySupportTicket,
} = require("../controllers/supportController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/", getSupportScreen);
router.get("/tickets", listMySupportTickets);
router.post("/tickets", createSupportTicket);
router.get("/tickets/:id", getMySupportTicketById);
router.post("/tickets/:id/replies", replyToMySupportTicket);

module.exports = router;

const express = require("express");

const {
  getContactScreen,
  submitContactMessage,
} = require("../controllers/contactController");

const router = express.Router();

router.get("/screen", getContactScreen);
router.post("/", submitContactMessage);

module.exports = router;

const express = require("express");

const { listTeamMembers, getTeamScreen } = require("../controllers/teamController");

const router = express.Router();

router.get("/", listTeamMembers);
router.get("/screen", getTeamScreen);

module.exports = router;

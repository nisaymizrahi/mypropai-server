const express = require("express");

const emailPreferencesController = require("../controllers/emailPreferencesController");

const router = express.Router();

router.get("/", emailPreferencesController.getPreferences);
router.patch("/", emailPreferencesController.updatePreferences);
router.post(
  "/unsubscribe",
  express.urlencoded({ extended: false }),
  emailPreferencesController.unsubscribeMarketing
);

module.exports = router;

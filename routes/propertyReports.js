const express = require("express");
const propertyReportController = require("../controllers/propertyReportController");

const router = express.Router();

router.get("/", propertyReportController.listReports);
router.post("/comps", propertyReportController.saveCompsReport);

module.exports = router;

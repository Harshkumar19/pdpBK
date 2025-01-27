const express = require("express");
const { getAllItems } = require("../controllers/itemController");

const router = express.Router();

router.get("/", getAllItems);

module.exports = router;

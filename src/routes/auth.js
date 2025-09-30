const express = require("express");
const router = express.Router();
const authController =  require('../controllers/auth/LoginController')

router.post('/login', authController.login);

router.post("/register", (req, res) => {
  res.send("Register route working ✅");
});

module.exports = router;  

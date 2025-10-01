const express = require("express");
const router = express.Router();
const loginController = require('../controllers/auth/LoginController');
const registerController = require('../controllers/auth/RegistrationController');
const authMiddleware = require("../middlewares/authMiddleware");

router.post('/login', loginController.login);
router.post("/register", registerController.registration);
router.get("/fetchdata", authMiddleware, (req, res) => {
    res.status(200).json({
        status: false,
        message: "Email or Username already exists"
    });
});

module.exports = router;  

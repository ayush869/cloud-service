const jwt = require("jsonwebtoken");
const User = require("../database/models/User");

module.exports = async function (req, res, next) {
    try {
        const token = req.headers["authorization"]?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ status: false, message: "No token provided" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({ status: false, message: "Invalid token" });
        }

        req.user = user; // attach user to request
        next();
    } catch (err) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
    }
};

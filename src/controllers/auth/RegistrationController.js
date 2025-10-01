const status = require('../../utils/Status');
const User = require('../../database/models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

class RegistrationController {
    async registration(req, res) {
        try {
            const { username, email, password, cnf_password, company_url } = req.body;

            if (!username || !email || !password || !cnf_password || !company_url) {
                return res.status(status.BAD_REQUEST).json({
                    status: false,
                    message: "All fields are required"
                });
            }

            if (password !== cnf_password) {
                return res.status(status.BAD_REQUEST).json({
                    status: false,
                    message: "Passwords do not match"
                });
            }

            const existingUser = await User.findOne({
                $or: [{ email }, { username }]
            });

            if (existingUser) {
                return res.status(status.CONFLICT).json({
                    status: false,
                    message: "Email or Username already exists"
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({
                username: username,
                email: email,
                password: hashedPassword,
                companyUrl: company_url,
                userType: "user"
            });

            await newUser.save();

            const token = jwt.sign(
                { id: newUser._id, email: newUser.email },
                process.env.JWT_SECRET,
                { expiresIn: "1d" }
            );

            return res.status(status.OK).json({
                status: true,
                message: "Registration successful",
                data: {
                    Jwt_Token: token,
                    id: newUser._id,
                    username: newUser.username,
                    email: newUser.email,
                    companyUrl: newUser.companyUrl,

                }
            });

        } catch (err) {
            console.error("Registration Error:", err);
            return res.status(status.INTERNAL_SERVER_ERROR).json({
                status: false,
                message: "Server Error"
            });
        }
    }
}

module.exports = new RegistrationController();

const status = require('../../utils/Status');
const User = require('../../database/models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

class LoginController {

    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(status.UNAUTHORIZED).json({
                status: false,
                message: "Invalid Inputs"
            });
        }

        try {
            const user = await User.findOne({ email });

            if (!user) {
                return res.status(status.NOT_FOUND).json({
                    status: false,
                    message: "User not found"
                });
            }
            const isPasswordMatch = await bcrypt.compare(password, user.password);

            if (!isPasswordMatch) {
                return res.status(status.UNAUTHORIZED).json({
                    status: false,
                    message: "Incorrect password"
                });
            }

            const token = jwt.sign(
                { id: user._id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            res.status(status.OK).json({
                status: true,
                message: "Login Success",
                data: {
                    Jwt_Token: token,
                    id: user._id,
                    email: user.email,
                    username: user.username,
                    companyUrl: user.companyUrl,
                    subscriptionStatus: user.subscriptionStatus,
                }
            });
        } catch (err) {
            console.error(err);
            res.status(status.INTERNAL_SERVER_ERROR).json({
                status: false,
                message: "Server Error"
            });
        }
    }
}

module.exports = new LoginController();

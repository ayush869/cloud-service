
class LoginController {
    async login(req, res) {
        const { email, password } = req.body;
        res.json({
            message: 'Login data received successfully',
            received: {
                email,
                password
            }
        });
    }
}
module.exports = new LoginController();

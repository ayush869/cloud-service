const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require("./database/db");
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB(); 
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Failed to start server:", err.message);
        process.exit(1);
    }
};
startServer();
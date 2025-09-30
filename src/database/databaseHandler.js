require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB connected");
    } catch (err) {
        console.error("❌ MongoDB connection error:", err.message);
        process.exit(1);
    }
};

const migrate = async () => {
    try {
        await connectDB();
        await User.init();
        console.log("✅ Migration complete. Collections are ready.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration error:", err);
        process.exit(1);
    }
};

const seed = async () => {
    try {
        await connectDB();
        const existing = await User.findOne({ email: "admin@gmail.com" });
        if (existing) {
            console.log("⚠️ Default user already exists");
        } else {
            const defaultUser = new User({
                email: "admin@gmail.com",
                username: "admin",
                companyUrl: "https://example.com",
                subscriptionStatus: "active",
                validity: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // 1 year validity
                password: "admin123",
                token: null,
                apiKey: "default-api-key",
                apiKey: "admin",
                userType: "admin",
            });
            await defaultUser.save();
            console.log("✅ Default user created");
        }
        process.exit(0);
    } catch (err) {
        console.error("❌ Seeding error:", err);
        process.exit(1);
    }
};

const dbwipe = async () => {
    try {
        await connectDB();
        await mongoose.connection.dropDatabase();
        console.log("🗑️ All collections dropped. Database wiped!");
        process.exit(0);
    } catch (err) {
        console.error("❌ DB wipe error:", err);
        process.exit(1);
    }
};

const command = process.argv[2];
if (command === "migrate") {
    migrate();
} else if (command === "seed") {
    seed();
} else if (command === "dbwipe") {
    dbwipe();
} else {
    console.log("❌ Unknown command. Use: migrate or seed");
    process.exit(1);
}

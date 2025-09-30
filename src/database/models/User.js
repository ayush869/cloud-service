const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(), 
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        username: {
            type: String,
            required: true,
            trim: true,
        },
        companyUrl: {
            type: String,
            required: true,
            trim: true,
        },
        subscriptionStatus: {
            type: String,
            enum: ["active", "inactive", "trial"],
            default: "trial",
        },
        validity: {
            type: Date,
            default: null,
        },
        password: {
            type: String,
            required: true,
        },
        token: {
            type: String,
            default: null,
        },
        apiKey: {
            type: String,
            default: null,
        },
        userType: {
            type: String,
            enum: ["admin", "user", "tester"],
            default: "tester",
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);

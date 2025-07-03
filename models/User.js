const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String }, // optional for Google login
    googleId: { type: String }, // for Google OAuth users
    avatar: { type: String },   // optional: profile picture URL
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);

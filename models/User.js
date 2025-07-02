const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String }, // Optional for Google login
    googleId: { type: String }, // Optional for Google login
    avatar: { type: String },   // Optional profile picture
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);

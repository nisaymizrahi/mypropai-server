const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const redisClient = require('../config/redisClient');

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// Helper function to generate a token
const generateToken = (user) => {
  return jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
};

// @desc    Register a new user
exports.signup = async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ message: "All fields are required" });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(409).json({ message: "Email already in use" });
        
        const user = await User.create({ email, password, name });

        const token = generateToken(user);
        res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Log in a user
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
    }

    try {
        const user = await User.findOne({ email }).select('+password');
        if (!user || !user.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const match = await user.comparePassword(password);
        if (!match) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = generateToken(user);
        res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Log out a user and blocklist the token
exports.logout = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.sendStatus(204);
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token);

        const expiresAt = decoded.exp * 1000;
        const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);

        if (remainingSeconds > 0) {
            await redisClient.set(token, 'blocklisted', {
                EX: remainingSeconds
            });
        }
        
        res.status(200).json({ message: "Logged out successfully" });
    } catch (err) {
        console.error("Logout error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Get the current logged-in user
exports.getMe = async (req, res) => {
    res.json(req.user);
};

// @desc    Update the logged-in user's profile
exports.updateMe = async (req, res) => {
    try {
        const { name, email } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        user.name = name || user.name;
        user.email = email || user.email;

        const updatedUser = await user.save();

        res.json({
            id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            avatar: updatedUser.avatar,
        });

    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ NEW: Function to change the user's password
exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Please provide both current and new passwords.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    try {
        const user = await User.findById(req.user.id).select('+password');

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect current password.' });
        }

        user.password = newPassword;
        await user.save();

        res.status(200).json({ message: 'Password changed successfully.' });
        
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};
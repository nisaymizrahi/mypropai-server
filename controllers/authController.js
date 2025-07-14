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
        
        // The pre-save hook in User.js will now handle hashing
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
            return res.sendStatus(204); // No token provided, nothing to do
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token);

        // Calculate remaining time until token expires
        const expiresAt = decoded.exp * 1000;
        const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);

        if (remainingSeconds > 0) {
            // Add the token to the Redis blocklist with an expiration
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
    // The user object is attached to req by the requireAuth middleware
    res.json(req.user);
};
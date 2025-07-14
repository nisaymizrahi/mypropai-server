const jwt = require("jsonwebtoken");
const mongoose = require('mongoose');
const User = mongoose.model('User');
const redisClient = require('../config/redisClient'); // 1. IMPORT REDIS CLIENT

const requireAuth = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization token required" });
  }

  const token = authorization.split(" ")[1];

  try {
    // 2. CHECK IF TOKEN IS ON THE BLOCKLIST
    const isBlocklisted = await redisClient.get(token);
    if (isBlocklisted) {
      return res.status(401).json({ error: "Token has been invalidated" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    req.user = user;
    
    next();
  } catch (err) {
    console.error("Auth failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

module.exports = requireAuth;

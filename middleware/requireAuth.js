const jwt = require("jsonwebtoken");
const mongoose = require('mongoose');
const User = mongoose.model('User'); // NEW: Import the User model

const requireAuth = async (req, res, next) => { // UPDATED: Made the function async
  const authHeader = req.get("Authorization");
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // NEW: Fetch the user from the database using the ID from the token
    const user = await User.findById(decoded.userId).select("-password"); // Exclude password for security

    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    // UPDATED: Attach the full user object to the request
    req.user = user;
    
    next();
  } catch (err) {
    console.error("Auth failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

module.exports = requireAuth;

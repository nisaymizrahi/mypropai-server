const jwt = require("jsonwebtoken");

const requireAuth = (req, res, next) => {
  const authHeader = req.get("Authorization"); // ✅ Express-safe
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error("Auth failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

module.exports = requireAuth;

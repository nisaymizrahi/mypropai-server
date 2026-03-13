const mongoose = require('mongoose');
const User = mongoose.model('User');
const redisClient = require('../config/redisClient'); // 1. IMPORT REDIS CLIENT
const { verifyJwt } = require('../utils/jwtConfig');
const { isPlatformManager } = require('../utils/platformAccess');

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

    const decoded = verifyJwt(token);
    
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended' });
    }

    const impersonation = {
      active: false,
    };

    if (decoded.impersonation) {
      const actorUser = await User.findById(decoded.actorUserId).select('-password');

      if (!actorUser || actorUser.accountStatus === 'suspended' || !isPlatformManager(actorUser)) {
        return res.status(403).json({ error: 'Impersonation token is no longer valid' });
      }

      req.actorUser = actorUser;
      impersonation.active = true;
      impersonation.actorUserId = actorUser.id;
      impersonation.actorEmail = actorUser.email;
      impersonation.startedAt = decoded.iat ? new Date(decoded.iat * 1000) : null;
    }

    req.user = user;
    req.auth = {
      token,
      impersonation,
    };
    
    next();
  } catch (err) {
    console.error("Auth failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

module.exports = requireAuth;

const { isPlatformManager } = require('../utils/platformAccess');

const requirePlatformManager = (req, res, next) => {
  if (!req.user || !isPlatformManager(req.user)) {
    return res.status(403).json({ msg: 'Platform manager access is restricted.' });
  }

  if (req.auth?.impersonation?.active) {
    return res.status(403).json({ msg: 'Exit impersonation before using platform manager controls.' });
  }

  return next();
};

module.exports = requirePlatformManager;

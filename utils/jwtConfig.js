const jwt = require('jsonwebtoken');

const DEV_FALLBACK_SECRET = 'dev_secret';

let hasWarnedAboutFallback = false;

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production.');
  }

  if (!hasWarnedAboutFallback) {
    hasWarnedAboutFallback = true;
    console.warn('[auth] JWT_SECRET is not set. Falling back to the local development secret.');
  }

  return DEV_FALLBACK_SECRET;
};

const signJwt = (payload, options = {}) => jwt.sign(payload, getJwtSecret(), options);

const verifyJwt = (token, options = {}) => jwt.verify(token, getJwtSecret(), options);

module.exports = {
  getJwtSecret,
  signJwt,
  verifyJwt,
};

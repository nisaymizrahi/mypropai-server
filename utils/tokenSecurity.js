const crypto = require('crypto');

const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');

const generateHashedToken = (size = 32) => {
  const token = crypto.randomBytes(size).toString('hex');

  return {
    token,
    tokenHash: hashToken(token),
  };
};

module.exports = {
  generateHashedToken,
  hashToken,
};

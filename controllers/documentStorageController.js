const User = require('../models/User');
const {
  buildStorageOverview,
  DocumentStorageError,
  getAssetAccessPayloadForUser,
} = require('../utils/documentStorageService');

exports.getStorageOverview = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    res.json(buildStorageOverview(user));
  } catch (error) {
    if (error instanceof DocumentStorageError) {
      return res.status(error.status).json({ msg: error.message, code: error.code });
    }

    console.error('Document storage overview error:', error);
    res.status(500).json({ msg: 'Failed to load document storage overview.' });
  }
};

exports.getAssetAccessUrl = async (req, res) => {
  try {
    const payload = await getAssetAccessPayloadForUser({
      assetId: req.params.assetId,
      userId: req.user.id,
      download: String(req.query.download || '').toLowerCase() === 'true',
    });

    res.json(payload);
  } catch (error) {
    if (error instanceof DocumentStorageError) {
      return res.status(error.status).json({ msg: error.message, code: error.code });
    }

    console.error('Document access URL error:', error);
    res.status(500).json({ msg: 'Failed to generate a secure document link.' });
  }
};

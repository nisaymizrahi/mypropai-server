require('dotenv').config();

const mongoose = require('mongoose');

const connectDB = require('../config/db');
const User = require('../models/User');
require('../models/DocumentAsset');

const {
  reconcileDocumentStorageUsageForUser,
} = require('../utils/documentStorageService');

const run = async () => {
  await connectDB();

  const userIdArg = process.argv.find((value) => value.startsWith('--userId=')) || '';
  const userId = userIdArg.split('=')[1] || '';
  const filter = userId ? { _id: userId } : {};

  const users = await User.find(filter).select('_id email').sort({ createdAt: 1 });

  for (const user of users) {
    const usage = await reconcileDocumentStorageUsageForUser(user._id);
    console.log(
      `[document-storage] ${user.email}: ${usage.fileCount} files / ${usage.bytesUsed} bytes`
    );
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('[document-storage] Reconcile failed:', error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});

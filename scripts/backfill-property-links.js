require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');

require('../models/User');
require('../models/Property');
require('../models/Lead');
require('../models/Investment');
require('../models/ManagedProperty');
require('../models/Unit');

const { backfillPropertyLinks } = require('../utils/propertyBackfillService');

const dryRun = process.argv.includes('--dry-run');

const main = async () => {
  await connectDB();

  try {
    const result = await backfillPropertyLinks({ dryRun });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async (error) => {
  console.error('[backfill-property-links] Failed:', error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('[backfill-property-links] Disconnect failed:', disconnectError);
  }
  process.exit(1);
});

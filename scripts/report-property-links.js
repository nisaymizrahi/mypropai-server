require('dotenv').config();

const connectDB = require('../config/db');

require('../models/User');
require('../models/Property');
require('../models/Lead');
require('../models/Investment');
require('../models/ManagedProperty');
require('../models/Unit');

const { getPropertyLinkStats } = require('../utils/propertyBackfillService');

const main = async () => {
  await connectDB();

  try {
    const stats = await getPropertyLinkStats();
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await require('mongoose').disconnect();
  }
};

main().catch(async (error) => {
  console.error('[report-property-links] Failed:', error);
  try {
    await require('mongoose').disconnect();
  } catch (disconnectError) {
    console.error('[report-property-links] Disconnect failed:', disconnectError);
  }
  process.exit(1);
});

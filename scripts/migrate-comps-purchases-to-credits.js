require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');

require('../models/Purchase');
require('../models/CompsCreditGrant');

const Purchase = require('../models/Purchase');
const { grantCompsCredits } = require('../utils/compsCredits');

const run = async () => {
  await connectDB();

  const purchases = await Purchase.find({
    kind: 'comps_report',
    status: 'paid',
  }).sort({ createdAt: 1 });

  let migratedCount = 0;

  for (const purchase of purchases) {
    const existingGrantKey = `migration:purchase:${purchase._id}`;
    const grant = await grantCompsCredits({
      userId: purchase.user,
      sourceType: 'migration',
      credits: 1,
      grantKey: existingGrantKey,
      metadata: {
        purchaseId: purchase._id.toString(),
        originalKind: purchase.kind,
        reason: 'legacy_comps_purchase_migration',
      },
    });

    if (grant) {
      migratedCount += 1;
      if (!purchase.fulfilledAt) {
        purchase.fulfilledAt = new Date();
        await purchase.save();
      }
    }
  }

  console.log(`Migrated ${migratedCount} legacy comps purchases into permanent credits.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Migration failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});

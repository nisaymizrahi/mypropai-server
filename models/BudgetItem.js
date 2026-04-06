const mongoose = require('mongoose');
const { nanoid } = require('nanoid');
const { applyBudgetScopeMeta, buildBudgetScopeMeta } = require('../utils/projectScopes');

const BudgetAwardSchema = new mongoose.Schema(
  {
    awardId: {
      type: String,
      default: () => nanoid(10),
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
    },
    vendorName: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    amount: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    sourceBid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bid',
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const BudgetItemSchema = new mongoose.Schema({
  // A unique, human-readable ID for this item.
  itemId: {
    type: String,
    default: () => nanoid(8),
    unique: true,
  },
  // Links this budget item back to the main investment project.
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sourceRenovationItemId: {
    type: String,
    trim: true,
    default: '',
  },
  scopeKey: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  scopeGroup: {
    type: String,
    trim: true,
    default: '',
  },
  category: {
    type: String,
    required: [true, 'Please provide a budget category (e.g., Plumbing, Electrical).'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Please provide a description of the work.'],
    trim: true,
  },
  budgetedAmount: {
    type: Number,
    required: [true, 'Please provide a budget amount.'],
    default: 0,
  },
  originalBudgetAmount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['Not Started', 'In Progress', 'Awaiting Materials', 'Complete', 'On Hold'],
    default: 'Not Started',
  },
  dueDate: {
    type: Date,
  },
  awards: [BudgetAwardSchema],
}, { timestamps: true });

const applyScopeTransform = (_doc, ret) => {
  applyBudgetScopeMeta(ret);
  return ret;
};

BudgetItemSchema.set('toJSON', {
  transform: applyScopeTransform,
});

BudgetItemSchema.set('toObject', {
  transform: applyScopeTransform,
});

BudgetItemSchema.pre('validate', function syncScopeMetadata(next) {
  const scopeMeta = buildBudgetScopeMeta({
    scopeKey: this.scopeKey,
    category: this.category,
    description: this.description,
  });

  this.scopeKey = scopeMeta.scopeKey;
  this.scopeGroup = scopeMeta.scopeGroup;
  this.category = String(this.category || scopeMeta.defaultCategory || '').trim();

  next();
});

module.exports = mongoose.model('BudgetItem', BudgetItemSchema);

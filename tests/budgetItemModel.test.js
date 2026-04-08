const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const BudgetItem = require("../models/BudgetItem");

test("BudgetItem allows empty descriptions for scope categories", () => {
  const budgetItem = new BudgetItem({
    investment: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    scopeKey: "kitchen",
    category: "Kitchen",
    description: "",
    budgetedAmount: 12500,
    originalBudgetAmount: 12500,
  });

  const validationError = budgetItem.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(budgetItem.description, "");
  assert.equal(budgetItem.category, "Kitchen");
  assert.equal(budgetItem.scopeKey, "kitchen");
});

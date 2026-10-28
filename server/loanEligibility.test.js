import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLoanEligibility,
  formatEligibilityExplanation,
} from "./loanEligibility.js";

test("eligibility explanation uses the calculated 50% rule and not an unsupported 30% limit", () => {
  const inputs = {
    salary: 100000,
    existingEMI: 10000,
    requiredEMI: 20000,
  };
  const result = analyzeLoanEligibility(inputs);
  const explanation = formatEligibilityExplanation(inputs, result);

  assert.equal(result.maxAffordableEMI, 50000);
  assert.equal(result.remainingEMI, 40000);
  assert.equal(result.eligible, true);
  assert.match(explanation, /50% salary rule/);
  assert.match(explanation, /₹50,000/);
  assert.match(explanation, /₹40,000/);
  assert.doesNotMatch(explanation, /30\s*%/i);
});

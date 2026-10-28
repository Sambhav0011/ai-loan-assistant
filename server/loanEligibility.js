export function analyzeLoanEligibility({ salary, existingEMI, requiredEMI }) {
  const maxAffordableEMI = salary * 0.5;
  const remainingEMI = maxAffordableEMI - existingEMI;

  return {
    maxAffordableEMI,
    remainingEMI,
    eligible: requiredEMI <= remainingEMI,
  };
}

export function formatEligibilityExplanation(
  { salary, existingEMI, requiredEMI },
  { maxAffordableEMI, remainingEMI, eligible },
) {
  const formatRupees = (amount) =>
    `₹${new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 0,
    }).format(amount)}`;

  return [
    "**Loan affordability estimate** (not a lender approval)",
    "",
    `- Monthly salary: ${formatRupees(salary)}`,
    `- Existing monthly EMIs: ${formatRupees(existingEMI)}`,
    `- Required new EMI: ${formatRupees(requiredEMI)}`,
    `- Maximum total EMI under this tool's 50% salary rule: ${formatRupees(maxAffordableEMI)}`,
    `- Remaining EMI capacity: ${formatRupees(remainingEMI)}`,
    `- Result: The required EMI is ${eligible ? "within" : "above"} the calculated remaining capacity.`,
    "",
    "This estimate uses only the configured rule: maximum total EMI is 50% of monthly salary, less existing EMIs. Lenders may use different criteria.",
  ].join("\n");
}

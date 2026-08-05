import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// -----------------------------
// EMI Query Detection
// -----------------------------
function isEMIQuery(text) {
  const lower = text.toLowerCase();

  return (
    lower.includes("emi") ||
    lower.includes("monthly installment") ||
    lower.includes("calculate emi") ||
    lower.includes("loan installment") ||
    lower.includes("loan amount") ||
    lower.includes("interest rate") ||
    lower.includes("tenure")
  );
}
function isEligibilityQuery(text) {
  const lower = text.toLowerCase();

  return (
    lower.includes("eligible") ||
    lower.includes("eligibility") ||
    lower.includes("can i get") ||
    lower.includes("loan eligibility") ||
    lower.includes("salary")
  );
}

// -----------------------------
// EMI Calculator Tool
// -----------------------------
function calculateEMI(principal, annualRate, years) {
  const monthlyRate = annualRate / 12 / 100;
  const months = years * 12;

  const emi =
    (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);

  const totalPayment = emi * months;
  const totalInterest = totalPayment - principal;

  return {
    emi: Math.round(emi),
    totalPayment: Math.round(totalPayment),
    totalInterest: Math.round(totalInterest),
    months,
  };
}

// -----------------------------
// Extract Loan Details
// -----------------------------
function extractLoanDetails(text) {
  const lower = text.toLowerCase();

  let amount = null;

  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*lakh/);

  if (lakhMatch) {
    amount = parseFloat(lakhMatch[1]) * 100000;
  } else {
    const numberMatch = lower.match(/₹?\s*(\d{5,})/);

    if (numberMatch) {
      amount = parseFloat(numberMatch[1]);
    }
  }

  const rateMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
  const rate = rateMatch ? parseFloat(rateMatch[1]) : null;

  const yearMatch = lower.match(/(\d+)\s*(?:year|years|yr)/);
  const years = yearMatch ? parseInt(yearMatch[1]) : null;

  return {
    amount,
    rate,
    years,
  };
}
function extractSalary(text) {
  const lower = text.toLowerCase();

  // Match: 6 lakh
  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*lakh/);

  if (lakhMatch) {
    return parseFloat(lakhMatch[1]) * 100000;
  }

  // Match: ₹60,000 or 60000
  const numberMatch = lower.match(/₹?\s*([\d,]+)/);

  if (numberMatch) {
    return Number(numberMatch[1].replace(/,/g, ""));
  }

  return null;
}
function extractExistingEMI(text) {
  const lower = text.toLowerCase();

  // Examples:
  // Existing EMI is ₹10,000
  // Existing EMI 15000
  // EMI 8000

  const match = lower.match(
    /existing\s*emi.*?₹?\s*([\d,]+)|emi.*?₹?\s*([\d,]+)/,
  );

  if (!match) {
    return 0;
  }

  return Number((match[1] || match[2]).replace(/,/g, ""));
}
function calculateEligibility(monthlyIncome) {
  const maxEMI = monthlyIncome * 0.5;

  return {
    monthlyIncome,
    maxEMI,
  };
}
function extractEligibilityDetails(text) {
  const salary = extractSalary(text);
  const existingEMI = extractExistingEMI(text);
  const { amount, rate, years } = extractLoanDetails(text);

  return {
    salary,
    existingEMI,
    amount,
    rate,
    years,
  };
}
// -----------------------------
// Conversation State
// -----------------------------
const conversations = {};

function analyzeLoanEligibility({
  salary,
  existingEMI,
  requiredEMI,
}) {
  const maxAffordableEMI = salary * 0.5;

  const remainingEMI = maxAffordableEMI - existingEMI;

  return {
    maxAffordableEMI,
    remainingEMI,
    eligible: requiredEMI <= remainingEMI,
  };
}

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, messages } = req.body;
    if (!conversations[sessionId]) {
  conversations[sessionId] = {
    step: null,
    salary: null,
    existingEMI: null,
    amount: null,
    rate: null,
    years: null,
  };
}
const conversationState = conversations[sessionId];

    // Validate request
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "Messages are required",
      });
    }

    const latestUserMessage = messages[messages.length - 1]?.content || "";
    // -----------------------------
    // Conversation Flow
    if (conversationState.step === "salary") {
      const salary = extractSalary(latestUserMessage);

      if (!salary) {
        return res.json({
          reply: `Please enter a valid monthly salary.

Example:

- ₹60,000
- 80000`,
        });
      }

      conversationState.salary = salary;
      conversationState.step = "existingEMI";

      console.log(conversationState);

      return res.json({
        reply: `Great!

I have saved your monthly salary as **₹${salary.toLocaleString("en-IN")}**.

### Question 2

What is your **existing monthly EMI**?

If you don't have any existing loans, simply reply **0**.`,
      });
    }
    // -----------------------------

    // Existing EMI Step
    if (conversationState.step === "existingEMI") {
      const existingEMI = Number(latestUserMessage.replace(/,/g, ""));

      if (isNaN(existingEMI) || existingEMI < 0) {
        return res.json({
          reply: `Please enter a valid monthly EMI.

Examples:

- 0
- 12000`,
        });
      }

      conversationState.existingEMI = existingEMI;
      conversationState.step = "amount";

      console.log(conversationState);

      return res.json({
        reply: `Perfect!

I've saved your existing EMI as **₹${existingEMI.toLocaleString("en-IN")}**.

### Question 3

What **loan amount** do you need?

Examples:

- ₹40 lakh
- ₹25 lakh`,
      });
    }
    // -----------------------------

    // Loan Amount Step
    if (conversationState.step === "amount") {
      const { amount } = extractLoanDetails(latestUserMessage);

      if (!amount) {
        return res.json({
          reply: `Please enter the required loan amount.

Examples:

- ₹20 lakh
- ₹40 lakh
- 2500000`,
        });
      }

      conversationState.amount = amount;
      conversationState.step = "rate";

      console.log(conversationState);

      return res.json({
        reply: `Great!

I've saved your loan amount as **₹${amount.toLocaleString("en-IN")}**.

### Question 4

What is the **expected interest rate**?

Examples:

- 8.5%
- 9%
- 10.25%`,
      });
    }
    // -----------------------------

// Interest Rate Step
// -----------------------------
if (conversationState.step === "rate") {
  const { rate } = extractLoanDetails(latestUserMessage);

  if (!rate) {
    return res.json({
      reply: `Please enter a valid annual interest rate.

Examples:

- 8.5%
- 9%
- 10.25%`,
    });
  }

  conversationState.rate = rate;
  conversationState.step = "years";

  console.log(conversationState);

  return res.json({
    reply: `Perfect!

I've saved the interest rate as **${rate}%**.

### Question 5

What is the **loan tenure**?

Examples:

- 20 years
- 15 years
- 10 years`,
  });
}
// -----------------------------

// Loan Tenure Step
// -----------------------------
if (conversationState.step === "years") {
  const { years } = extractLoanDetails(latestUserMessage);

  if (!years) {
    return res.json({
      reply: `Please enter a valid loan tenure.

Examples:

- 20 years
- 15 years
- 10 years`,
    });
  }

  conversationState.years = years;

  // Calculate EMI
  const emiResult = calculateEMI(
    conversationState.amount,
    conversationState.rate,
    conversationState.years
  );

  // Analyze eligibility
  const eligibility = analyzeLoanEligibility({
    salary: conversationState.salary,
    existingEMI: conversationState.existingEMI,
    requiredEMI: emiResult.emi,
  });

  const reply = `# Loan Eligibility Report

## Your Details

- **Monthly Salary:** ₹${conversationState.salary.toLocaleString("en-IN")}
- **Existing EMI:** ₹${conversationState.existingEMI.toLocaleString("en-IN")}
- **Loan Amount:** ₹${conversationState.amount.toLocaleString("en-IN")}
- **Interest Rate:** ${conversationState.rate}%
- **Loan Tenure:** ${conversationState.years} years

---

## EMI Calculation

- **Estimated EMI:** ₹${emiResult.emi.toLocaleString("en-IN")}

---

## Affordability

- **Maximum Recommended EMI:** ₹${eligibility.maxAffordableEMI.toLocaleString("en-IN")}
- **Remaining EMI Capacity:** ₹${eligibility.remainingEMI.toLocaleString("en-IN")}

---

## Result

${
  eligibility.eligible
    ? "✅ Based on this simple affordability calculation, you appear to be eligible."
    : "❌ Based on this simple affordability calculation, the EMI is higher than your recommended limit."
}

> This is only an estimate. Actual approval depends on your CIBIL score, bank policies, employment, age and other eligibility criteria.
`;

  // Reset conversation
  conversationState.step = null;
  conversationState.salary = null;
  conversationState.existingEMI = null;
  conversationState.amount = null;
  conversationState.rate = null;
  conversationState.years = null;

  console.log(conversationState);

  return res.json({
    reply,
  });
}

    const details = extractEligibilityDetails(latestUserMessage);
    console.log("Eligibility Details:");
    console.log(details);

    // -----------------------------
    // EMI Tool
    // -----------------------------
    if (isEMIQuery(latestUserMessage)) {
      const { amount, rate, years } = extractLoanDetails(latestUserMessage);

      if (amount && rate && years) {
        const result = calculateEMI(amount, rate, years);

        return res.json({
          reply: `# EMI Calculation Result

For a **₹${(amount / 100000).toFixed(
            0,
          )} lakh** loan at **${rate}%** annual interest for **${years} years**

---

## Monthly EMI

# **₹${result.emi.toLocaleString("en-IN")}**

---

## Loan Summary

- **Loan Amount:** ₹${amount.toLocaleString("en-IN")}
- **Interest Rate:** ${rate}% per year
- **Tenure:** ${years} years (${result.months} months)
- **Total Interest Payable:** ₹${result.totalInterest.toLocaleString("en-IN")}
- **Total Amount Payable:** ₹${result.totalPayment.toLocaleString("en-IN")}

---

## What this means

You would pay approximately **₹${result.emi.toLocaleString(
            "en-IN",
          )} every month** for **${years} years**.

Over the full tenure, you would pay **₹${result.totalInterest.toLocaleString(
            "en-IN",
          )} as interest**, in addition to the original loan amount.

---

> **Note:** This is an estimate based on the standard reducing-balance EMI formula. Actual EMI may vary slightly depending on lender policies, insurance charges and loan processing fees.`,
        });
      }

      return res.json({
        reply: `# EMI Calculator

I can calculate your EMI instantly.

Please provide:

- **Loan Amount** (Example: ₹20 lakh)
- **Interest Rate** (Example: 8.5%)
- **Loan Tenure** (Example: 20 years)

### Example

**Calculate EMI for ₹20 lakh at 8.5% for 20 years**`,
      });
    }

    // -----------------------------
    // Loan Eligibility Conversation
    // -----------------------------
    if (isEligibilityQuery(latestUserMessage)) {
      conversationState.step = "salary";

      return res.json({
        reply: `# Loan Eligibility Check

I'll help you estimate your loan eligibility.

Let's do it step by step.

### Question 1

What is your **monthly salary**?

Example:

- ₹60,000
- ₹80,000 per month
`,
      });
    }

    const recentMessages = messages.slice(-10);
    const response = await client.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `
You are an AI Loan Assistant designed primarily for users in India.

Your job is to explain loan concepts, eligibility, documentation,
loan terminology, lending processes, and general financial workflows
in simple and easy-to-understand language.

RESPONSE STYLE:

1. Use clear headings.
2. Use Markdown.
3. Use bullet points.
4. Use numbered lists when explaining steps.
5. Keep answers concise.
6. Highlight important terms using **bold**.
7. Never use HTML tags.
8. Use tables only when useful.
9. Avoid unnecessary repetition.

INDIA CONTEXT:

Prefer concepts such as:

- PAN Card
- Aadhaar
- Form 16
- ITR
- Salary Slips
- Bank Statements
- Address Proof
- Employment Details
- CIBIL Score
- Property Documents

Avoid US-specific terms like:

- Social Security Number
- W-2
- 1099

ACCURACY:

- Requirements vary by bank and loan type.
- Never guarantee loan approval.
- Never guarantee approval based on CIBIL score.
- Tell users to verify changing rates with lenders.

LOAN SAFETY:

You cannot approve or reject loans.

You are an informational assistant only.

If the question is unrelated to loans, politely explain that you specialize in loan-related topics.
`,
        },

        ...recentMessages,
      ],
    });

    res.json({
      reply: response.choices[0].message.content,
    });
  } catch (error) {
    console.error("AI API Error:", error);

    res.status(500).json({
      error: "Something went wrong while processing the request.",
    });
  }
});

app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});

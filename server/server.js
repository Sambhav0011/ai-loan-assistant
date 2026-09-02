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
// AI Tools
// -----------------------------
const tools = [
  {
    type: "function",
    function: {
      name: "calculate_emi",
      description:
        "Calculate the monthly EMI, total interest, and total payment for a loan.",
      parameters: {
        type: "object",
        properties: {
          principal: {
            type: "number",
            description: "The loan amount in Indian rupees.",
          },
          annualRate: {
            type: "number",
            description: "The annual interest rate in percentage.",
          },
          years: {
            type: "number",
            description: "The loan tenure in years.",
          },
        },
        required: ["principal", "annualRate", "years"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "check_loan_eligibility",
      description:
        "Estimate whether a loan EMI is affordable based on monthly salary, existing EMI, and required loan EMI. Use this tool only when all three values are available. If any value is missing, ask the user for the missing information instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          salary: {
            type: "number",
            description: "Monthly salary in Indian rupees.",
          },

          existingEMI: {
            type: "number",
            description:
              "Existing monthly EMI obligations in Indian rupees. Use 0 only if the user explicitly says they have no existing EMI.",
          },

          requiredEMI: {
            type: "number",
            description:
              "Monthly EMI required for the new loan in Indian rupees.",
          },
        },

        required: ["salary", "existingEMI", "requiredEMI"],
      },
    },
  },
];

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

// -----------------------------
// Eligibility Query Detection
// -----------------------------
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
// EMI Calculator
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
// Validate Tool Numbers
// -----------------------------
function isValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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

// -----------------------------
// Extract Salary
// -----------------------------
function extractSalary(text) {
  const lower = text.toLowerCase();

  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*lakh/);

  if (lakhMatch) {
    return parseFloat(lakhMatch[1]) * 100000;
  }

  const numberMatch = lower.match(/₹?\s*([\d,]+)/);

  if (numberMatch) {
    return Number(numberMatch[1].replace(/,/g, ""));
  }

  return null;
}

// -----------------------------
// Extract Existing EMI
// -----------------------------
function extractExistingEMI(text) {
  const lower = text.toLowerCase();

  const match = lower.match(
    /existing\s*emi.*?₹?\s*([\d,]+)|emi.*?₹?\s*([\d,]+)/,
  );

  if (!match) {
    return 0;
  }

  return Number((match[1] || match[2]).replace(/,/g, ""));
}

// -----------------------------
// Basic Eligibility
// -----------------------------
function calculateEligibility(monthlyIncome) {
  const maxEMI = monthlyIncome * 0.5;

  return {
    monthlyIncome,
    maxEMI,
  };
}

// -----------------------------
// Extract Eligibility Details
// -----------------------------
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

// -----------------------------
// Eligibility Calculation
// -----------------------------
function analyzeLoanEligibility({ salary, existingEMI, requiredEMI }) {
  const maxAffordableEMI = salary * 0.5;

  const remainingEMI = maxAffordableEMI - existingEMI;

  return {
    maxAffordableEMI,
    remainingEMI,
    eligible: requiredEMI <= remainingEMI,
  };
}

// -----------------------------
// Clear Conversation
// -----------------------------
app.delete("/api/chat/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  if (conversations[sessionId]) {
    delete conversations[sessionId];
  }

  return res.json({
    message: "Conversation session cleared",
  });
});

// -----------------------------
// Chat API
// -----------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, messages } = req.body;

    // -----------------------------
    // Validate Request
    // -----------------------------
    if (!sessionId) {
      return res.status(400).json({
        error: "Session ID is required",
      });
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "Messages are required",
      });
    }

    // -----------------------------
    // Create Session State
    // -----------------------------
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

    const latestUserMessage = messages[messages.length - 1]?.content || "";

    // =============================
    // OLD MULTI-STEP FLOW
    // =============================

    // -----------------------------
    // Salary Step
    // -----------------------------
    if (conversationState.step === "salary") {
      const salary = extractSalary(latestUserMessage);

      if (!salary) {
        return res.json({
          reply: `Please enter a valid monthly salary.

Example:

- ₹60,000
- ₹80,000`,
        });
      }

      conversationState.salary = salary;
      conversationState.step = "existingEMI";

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

      const emiResult = calculateEMI(
        conversationState.amount,
        conversationState.rate,
        conversationState.years,
      );

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

- **Maximum Recommended EMI:** ₹${eligibility.maxAffordableEMI.toLocaleString(
        "en-IN",
      )}
- **Remaining EMI Capacity:** ₹${eligibility.remainingEMI.toLocaleString(
        "en-IN",
      )}

---

## Result

${eligibility.eligible
          ? "✅ Based on this simple affordability calculation, you appear to be eligible."
          : "❌ Based on this simple affordability calculation, the EMI is higher than your recommended limit."
        }

> This is only an estimate. Actual approval depends on your CIBIL score, bank policies, employment, age and other eligibility criteria.`;

      // Reset state
      conversationState.step = null;
      conversationState.salary = null;
      conversationState.existingEMI = null;
      conversationState.amount = null;
      conversationState.rate = null;
      conversationState.years = null;

      return res.json({
        reply,
      });
    }

    // =============================
    // AI / GROQ
    // =============================

    const recentMessages = messages.slice(-10);

    const aiMessages = [
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
You only provide informational estimates.

If the user asks for an EMI calculation and provides loan amount, interest rate and tenure, use calculate_emi.

If the user asks about loan eligibility and provides:
- salary
- existing EMI
- required new EMI

use check_loan_eligibility.

If the user asks about eligibility and provides salary, existing EMI, loan amount, interest rate and tenure, but does not provide the new EMI:

1. First use calculate_emi.
2. Use the returned EMI as requiredEMI.
3. Then use check_loan_eligibility.
4. Finally explain the result.

When a tool requires information that the user has not provided, do not guess the missing values.

Ask the user for the missing information.

Only call check_loan_eligibility when salary, existing EMI and required new EMI are known.

Never guess missing financial values.

Do not mention internal tool calls to the user.
`,
      },

      ...recentMessages,
    ];

    // =============================
    // MULTI-TOOL LOOP
    // =============================

    for (let i = 0; i < 5; i++) {
      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: aiMessages,
        tools,
        tool_choice: "auto",
      });

      const assistantMessage = response.choices[0].message;

      // -----------------------------
      // No more tools needed
      // -----------------------------
      if (!assistantMessage.tool_calls?.length) {
        return res.json({
          reply: assistantMessage.content,
        });
      }

      // Save AI's tool request
      aiMessages.push(assistantMessage);

      // -----------------------------
      // Execute Tools
      // -----------------------------
      for (const toolCall of assistantMessage.tool_calls) {
        let args;

        // -----------------------------
        // Safe JSON Parsing
        // -----------------------------
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          console.error("Invalid tool arguments:", error);

          aiMessages.push({
            role: "tool",

            tool_call_id: toolCall.id,

            content: JSON.stringify({
              error: "Invalid tool arguments.",
            }),
          });

          continue;
        }
        console.log("Tool selected:", toolCall.function.name);
        console.log("Arguments:", args);

        let result;

        // =============================
        // calculate_emi
        // =============================
        if (toolCall.function.name === "calculate_emi") {
          if (
            !isValidNumber(args.principal) ||
            !isValidNumber(args.annualRate) ||
            !isValidNumber(args.years)
          ) {
            result = {
              error: "Invalid EMI input values.",
            };
          } else {
            result = calculateEMI(args.principal, args.annualRate, args.years);
          }
        }

        // =============================
        // check_loan_eligibility
        // =============================
        else if (toolCall.function.name === "check_loan_eligibility") {
          if (
            !isValidNumber(args.salary) ||
            !isValidNumber(args.existingEMI) ||
            !isValidNumber(args.requiredEMI)
          ) {
            result = {
              error: "Invalid eligibility input values.",
            };
          } else {
            result = analyzeLoanEligibility({
              salary: args.salary,

              existingEMI: args.existingEMI,

              requiredEMI: args.requiredEMI,
            });
          }
        }

        // =============================
        // Unknown Tool
        // =============================
        else {
          result = {
            error: `Unknown tool: ${toolCall.function.name}`,
          };
        }

        console.log("Tool result:", result);

        // Send tool result back to AI
        aiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Safety limit
    return res.status(500).json({
      error: "Too many tool calls.",
    });
  } catch (error) {
    console.error("AI API Error:", error);

    return res.status(500).json({
      error: "Something went wrong while processing the request.",
    });
  }
});

// -----------------------------
// Start Server
// -----------------------------
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});

import pool from "./db.js";
import { retrieveRelevantChunks } from "./retrieveDocuments.js";

const testQuestions = [
  {
    question: "What is the minimum salary required for a personal loan?",
    expected: (content) => content.includes("minimum monthly income"),
  },
  {
    question: "What documents do I need to apply?",
    expected: (content) => content.includes("required documents"),
  },
  {
    question: "How long can I take to repay my loan?",
    expected: (content) => content.includes("repayment period"),
  },
  {
    question: "What is the maximum loan amount?",
    expected: (content) => content.includes("maximum loan amount"),
  },
];

let passed = 0;

try {
  for (const { question, expected } of testQuestions) {
    console.log(`\nQuestion: ${question}`);
    try {
      const chunks = await retrieveRelevantChunks(question);

      if (chunks.length === 0) {
        console.log("No matching chunks found.");
        continue;
      }

      chunks.forEach((chunk, index) => {
        console.log(
          `\n${index + 1}. ${chunk.document_name} (similarity: ${Number(chunk.similarity).toFixed(4)})`,
        );
        console.log(chunk.content);
      });

      const firstResultMatches = expected(chunks[0].content.toLowerCase());
      console.log(
        `Expected policy chunk ranked first: ${firstResultMatches ? "PASS" : "FAIL"}`,
      );
      if (firstResultMatches) passed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      console.error(`Question retrieval failed: ${message}`);
    }
  }
} finally {
  await pool.end();
}

console.log(`\nRetrieval checks: ${passed}/${testQuestions.length} passed.`);
if (passed !== testQuestions.length) {
  process.exitCode = 1;
}
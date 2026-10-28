import pool from "./db.js";
import { generateEmbedding } from "./embeddings.js";

const maximumLimit = 20;
const embeddingDimensions = 768;

export async function retrieveRelevantChunks(question, limit = 3) {
  if (typeof question !== "string" || question.trim().length === 0) {
    throw new Error("Question must be a non-empty string.");
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new Error(`Limit must be an integer between 1 and ${maximumLimit}.`);
  }

  const embedding = await generateEmbedding(question.trim(), "RETRIEVAL_QUERY");
  if (
    !Array.isArray(embedding) ||
    embedding.length !== embeddingDimensions ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new Error(
      `Question embedding must contain ${embeddingDimensions} finite numbers.`,
    );
  }

  // pgvector accepts this text representation when explicitly cast to vector.
  const vector = `[${embedding.join(",")}]`;

  try {
    const result = await pool.query(
      `SELECT
         id,
         document_name,
         content,
         1 - (embedding <=> $1::vector) AS similarity
       FROM document_chunks
       WHERE document_id IS NULL
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $2`,
      [vector, limit],
    );
    return result.rows;
  } catch {
    throw new Error("Could not search document chunks in the database.");
  }
}
import { GoogleGenAI } from "@google/genai";

const model = "gemini-embedding-001";
const outputDimensionality = 768;
const validTaskTypes = new Set(["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]);
let client;

export async function generateEmbedding(text, taskType) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Embedding text must be a non-empty string.");
  }

  if (!validTaskTypes.has(taskType)) {
    throw new Error(
      "Embedding task type must be RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY.",
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in the server environment.");
  }

  try {
    client ??= new GoogleGenAI({ apiKey });
    const response = await client.models.embedContent({
      model,
      contents: text,
      config: { taskType, outputDimensionality },
    });
    const embedding = response.embeddings?.[0]?.values;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== outputDimensionality ||
      !embedding.every((value) => Number.isFinite(value))
    ) {
      throw new Error(
        `Gemini returned an invalid embedding; expected ${outputDimensionality} finite numbers.`,
      );
    }

    return embedding;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Gemini returned")) {
      throw error;
    }
    throw new Error(
      "Gemini embedding request failed. Check the API key configuration, network access, and Gemini API availability.",
      { cause: error },
    );
  }
}

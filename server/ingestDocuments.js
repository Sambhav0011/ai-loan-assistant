import { readFile } from "node:fs/promises";
import pool from "./db.js";
import { chunkDocument } from "./chunkDocument.js";
import { generateEmbedding } from "./embeddings.js";

const documentUrl = new URL("./documents/personal_loan_policy.txt", import.meta.url);
const documentName = "personal_loan_policy.txt";

async function ingestDocuments() {
  try {
    const document = await readFile(documentUrl, "utf8");
    const chunks = chunkDocument(document);

    if (chunks.length === 0) {
      throw new Error("The loan policy document contains no text chunks.");
    }

    const embeddings = [];
    for (const [index, chunk] of chunks.entries()) {
      console.log(`Processing chunk ${index + 1} of ${chunks.length}`);
      embeddings.push(await generateEmbedding(chunk, "RETRIEVAL_DOCUMENT"));
    }

    const client = await pool.connect();
    try {
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;

        await client.query(
          "DELETE FROM document_chunks WHERE document_name = $1",
          [documentName],
        );

        for (const [index, chunk] of chunks.entries()) {
          const vector = `[${embeddings[index].join(",")}]`;
          await client.query(
            `INSERT INTO document_chunks (document_name, content, embedding)
             VALUES ($1, $2, $3::vector)`,
            [documentName, chunk, vector],
          );
        }

        await client.query("COMMIT");
        transactionStarted = false;
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            const rollbackMessage =
              rollbackError instanceof Error
                ? rollbackError.message
                : "Unknown rollback error.";
            console.error(`Database rollback failed: ${rollbackMessage}`);
            throw error;
          }
        }
        throw error;
      }
    } finally {
      client.release();
    }

    console.log(
      `Successfully stored ${chunks.length} chunks for ${documentName}.`,
    );
  } finally {
    await pool.end();
  }
}

ingestDocuments().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`Document ingestion failed: ${message}`);
  process.exitCode = 1;
});

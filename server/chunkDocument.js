import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const documentUrl = new URL("./documents/personal_loan_policy.txt", import.meta.url);

export function chunkDocument(document) {
  // Split immediately before each numbered policy heading.
  return document
    .split(/(?=^\d+\.\s)/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

const isExecutedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isExecutedDirectly) {
  try {
    const document = await readFile(documentUrl, "utf8");
    const chunks = chunkDocument(document);

    console.log(`Total chunks: ${chunks.length}`);
    chunks.forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1}:\n${chunk}`);
    });
  } catch (error) {
    console.error("Could not read the loan policy document:", error);
    process.exitCode = 1;
  }
}

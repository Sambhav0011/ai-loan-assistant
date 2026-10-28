import { PDFParse } from "pdf-parse";

export const MAX_PDF_PAGES = 20;
export const MAX_PDF_TEXT_CHARACTERS = 100_000;
export const MAX_PDF_CHUNKS = 30;
const MAX_CHUNK_CHARACTERS = 1800;
const CHUNK_OVERLAP_CHARACTERS = 200;

export function sanitizePdfFilename(filename) {
  const safeName = filename
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim()
    .slice(0, 120);

  return safeName.toLowerCase().endsWith(".pdf")
    ? safeName
    : `${safeName || "document"}.pdf`;
}

export async function extractPdfText(buffer) {
  if (
    buffer.length < 8 ||
    buffer.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    !buffer.subarray(-2048).includes(Buffer.from("%%EOF"))
  ) {
    throw new Error("The uploaded file is not a valid, readable PDF.");
  }

  const parser = new PDFParse({ data: buffer });
  try {
    let info;
    try {
      info = await parser.getInfo();
    } catch {
      throw new Error("The uploaded PDF is encrypted or unreadable.");
    }
    if (info.total < 1 || info.total > MAX_PDF_PAGES) {
      throw new Error(`PDFs must contain between 1 and ${MAX_PDF_PAGES} pages.`);
    }

    let result;
    try {
      result = await parser.getText();
    } catch {
      throw new Error("The uploaded PDF is encrypted or unreadable.");
    }
    const text = result.text.replace(/--\s+\d+\s+of\s+\d+\s+--/g, " ").trim();
    if (!text) {
      throw new Error("The PDF contains no extractable text. Scanned PDFs need OCR.");
    }
    if (text.length > MAX_PDF_TEXT_CHARACTERS) {
      throw new Error(
        `Extracted PDF text exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character limit.`,
      );
    }

    return { text, pageCount: info.total };
  } finally {
    await parser.destroy();
  }
}

function splitLongParagraph(paragraph) {
  const chunks = [];
  let start = 0;

  while (start < paragraph.length) {
    const end = Math.min(start + MAX_CHUNK_CHARACTERS, paragraph.length);
    chunks.push(paragraph.slice(start, end).trim());
    if (end === paragraph.length) break;
    start = end - CHUNK_OVERLAP_CHARACTERS;
  }

  return chunks.filter(Boolean);
}

export function chunkPdfText(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARACTERS) {
      if (current) chunks.push(current);
      chunks.push(...splitLongParagraph(paragraph));
      current = "";
      continue;
    }

    const combined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (combined.length <= MAX_CHUNK_CHARACTERS) {
      current = combined;
    } else {
      chunks.push(current);
      const overlapLength = Math.min(
        CHUNK_OVERLAP_CHARACTERS,
        MAX_CHUNK_CHARACTERS - paragraph.length - 2,
      );
      current = `${current.slice(-Math.max(0, overlapLength))}\n\n${paragraph}`;
    }
  }

  if (current) chunks.push(current);
  const cleanedChunks = chunks.map((chunk) => chunk.trim()).filter(Boolean);

  if (cleanedChunks.length > MAX_PDF_CHUNKS) {
    throw new Error(`PDF text exceeds the ${MAX_PDF_CHUNKS}-chunk limit.`);
  }
  return cleanedChunks;
}

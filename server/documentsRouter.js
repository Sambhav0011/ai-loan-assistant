import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import pool from "./db.js";
import { generateEmbedding } from "./embeddings.js";
import {
  chunkPdfText,
  extractPdfText,
  sanitizePdfFilename,
} from "./pdfDocuments.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const vectorDimensions = 768;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
  fileFilter(_req, file, callback) {
    const hasPdfExtension = /\.pdf$/i.test(file.originalname);
    if (!hasPdfExtension || file.mimetype !== "application/pdf") {
      return callback(new Error("Upload a PDF file using the application/pdf type."));
    }
    callback(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "PDF must be 5 MB or smaller." });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: "Upload one PDF in the 'file' field." });
    }
    return res.status(400).json({
      error: error.message || "The uploaded file is invalid.",
    });
  });
}

function validateEmbedding(embedding) {
  return (
    Array.isArray(embedding) &&
    embedding.length === vectorDimensions &&
    embedding.every(Number.isFinite)
  );
}

export function createDocumentsRouter({
  authenticate,
  database = pool,
  embed = generateEmbedding,
}) {
  const router = express.Router();
  const uploadLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => req.user.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.get("/", authenticate, async (req, res) => {
    try {
      const result = await database.query(
        `SELECT id, filename, status, file_size, page_count, chunk_count,
                created_at, updated_at
         FROM uploaded_documents
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.userId],
      );
      return res.json({ documents: result.rows });
    } catch (error) {
      console.error("Could not list uploaded documents:", error.message);
      return res.status(500).json({ error: "Could not load your documents." });
    }
  });

  router.post("/upload", authenticate, uploadLimit, handleUpload, async (req, res) => {
    let documentId;
    const userId = req.user.userId;

    try {
      if (!req.file || req.file.size === 0) {
        return res.status(400).json({ error: "A non-empty PDF file is required." });
      }

      const { text, pageCount } = await extractPdfText(req.file.buffer);
      const chunks = chunkPdfText(text);
      if (chunks.length === 0) {
        return res.status(422).json({
          error: "The PDF contains no extractable text. Scanned PDFs need OCR.",
        });
      }

      const filename = sanitizePdfFilename(req.file.originalname);
      documentId = randomUUID();
      await database.query(
        `INSERT INTO uploaded_documents
           (id, user_id, filename, content_type, file_size, status)
         VALUES ($1, $2, $3, 'application/pdf', $4, 'processing')`,
        [documentId, userId, filename, req.file.size],
      );

      const embeddings = [];
      for (const chunk of chunks) {
        const embedding = await embed(chunk, "RETRIEVAL_DOCUMENT");
        if (!validateEmbedding(embedding)) {
          throw new Error("Embedding service returned an invalid vector.");
        }
        embeddings.push(embedding);
      }

      const client = await database.connect();
      try {
        await client.query("BEGIN");
        for (const [index, chunk] of chunks.entries()) {
          const vector = `[${embeddings[index].join(",")}]`;
          const inserted = await client.query(
            `INSERT INTO document_chunks
               (document_id, document_name, content, embedding)
             SELECT $1, $2, $3, $4::vector
             WHERE EXISTS (
               SELECT 1 FROM uploaded_documents
               WHERE id = $1 AND user_id = $5 AND status = 'processing'
             )`,
            [documentId, filename, chunk, vector, userId],
          );
          if (inserted.rowCount !== 1) {
            throw new Error("Document ownership could not be verified.");
          }
        }

        const updated = await client.query(
          `UPDATE uploaded_documents
           SET status = 'ready', page_count = $3, chunk_count = $4,
               updated_at = NOW()
           WHERE id = $1 AND user_id = $2 AND status = 'processing'
           RETURNING id`,
          [documentId, userId, pageCount, chunks.length],
        );
        if (updated.rowCount !== 1) {
          throw new Error("Document ownership could not be verified.");
        }
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Document upload rollback failed:", rollbackError.message);
        }
        throw error;
      } finally {
        client.release();
      }

      return res.status(201).json({
        document: {
          id: documentId,
          filename,
          status: "ready",
          pageCount,
          chunkCount: chunks.length,
        },
      });
    } catch (error) {
      console.error("Document upload failed:", error.message);
      if (documentId) {
        try {
          await database.query(
            `UPDATE uploaded_documents
             SET status = 'failed', updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND status = 'processing'`,
            [documentId, userId],
          );
        } catch (statusError) {
          console.error("Could not mark uploaded document as failed:", statusError.message);
        }
      }

      const clientError =
        /PDF|extractable|Scanned|character limit|page|chunk limit/i.test(error.message);
      return res.status(clientError ? 422 : 500).json({
        error: clientError
          ? error.message
          : "The PDF could not be processed. Please try again later.",
      });
    }
  });

  return router;
}

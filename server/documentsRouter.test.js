import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import test, { after, before } from "node:test";
import { authMiddleware } from "./auth.js";
import { createDocumentsRouter } from "./documentsRouter.js";
import { sanitizePdfFilename } from "./pdfDocuments.js";

process.env.JWT_SECRET = "test-secret-for-upload-tests";

const userId = "620f2b3a-42dc-4ceb-a90b-581852f1038a";
const secondUserId = "ce0b562b-f400-4e31-85d8-cc4c83043c04";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const servers = [];

function createPdf(text = "Fictional loan policy. Income must be at least 25000.") {
  const escapedText = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`)} >>\nstream\nBT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

class MockDatabase {
  documents = new Map();
  chunks = [];
  existingPolicyChunkCount = 7;
  failChunkInsert = false;

  async query(sql, params = []) {
    if (sql.includes("INSERT INTO uploaded_documents")) {
      const [id, ownerId, filename, fileSize] = params;
      this.documents.set(id, {
        id,
        user_id: ownerId,
        filename,
        status: "processing",
        file_size: fileSize,
      });
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes("UPDATE uploaded_documents") && sql.includes("status = 'failed'")) {
      const [id, ownerId] = params;
      const document = this.documents.get(id);
      if (document?.user_id === ownerId) document.status = "failed";
      return { rowCount: document?.user_id === ownerId ? 1 : 0, rows: [] };
    }

    if (sql.includes("FROM uploaded_documents") && sql.includes("WHERE user_id = $1")) {
      const [ownerId] = params;
      return {
        rows: [...this.documents.values()].filter((document) => document.user_id === ownerId),
      };
    }

    throw new Error("Unexpected fake database query.");
  }

  async connect() {
    let pendingChunks = [];
    return {
      query: async (sql, params = []) => {
        if (sql === "BEGIN") {
          pendingChunks = [];
          return { rowCount: null, rows: [] };
        }
        if (sql === "ROLLBACK") {
          pendingChunks = [];
          return { rowCount: null, rows: [] };
        }
        if (sql === "COMMIT") {
          this.chunks.push(...pendingChunks);
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("INSERT INTO document_chunks")) {
          if (this.failChunkInsert) throw new Error("Simulated database insert failure.");
          const [id, filename, content, vector, ownerId] = params;
          const document = this.documents.get(id);
          if (document?.user_id !== ownerId || document.status !== "processing") {
            return { rowCount: 0, rows: [] };
          }
          pendingChunks.push({ document_id: id, document_name: filename, content, vector });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE uploaded_documents") && sql.includes("status = 'ready'")) {
          const [id, ownerId, pageCount, chunkCount] = params;
          const document = this.documents.get(id);
          if (document?.user_id !== ownerId || document.status !== "processing") {
            return { rowCount: 0, rows: [] };
          }
          document.status = "ready";
          document.page_count = pageCount;
          document.chunk_count = chunkCount;
          return { rowCount: 1, rows: [{ id }] };
        }
        throw new Error("Unexpected fake transaction query.");
      },
      release() {},
    };
  }
}

async function startTestServer(database, embed = async () => Array(768).fill(0.25)) {
  const app = express();
  app.use(
    "/api/documents",
    createDocumentsRouter({ authenticate: authMiddleware, database, embed }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}/api/documents`;
}

function tokenFor(id = userId) {
  return jwt.sign({ userId: id }, process.env.JWT_SECRET);
}

async function postPdf(url, { token = tokenFor(), buffer = createPdf(), filename = "sample.pdf", type = "application/pdf" } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), filename);
  return fetch(`${url}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

before(() => {
  process.env.JWT_SECRET = "test-secret-for-upload-tests";
});

after(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

test("upload rejects missing and invalid JWT before reading the file", async () => {
  const url = await startTestServer(new MockDatabase());
  const missing = await postPdf(url, { token: "" });
  assert.equal(missing.status, 401);
  const invalid = await postPdf(url, { token: "not-a-valid-token" });
  assert.equal(invalid.status, 401);
});

test("stored PDF filenames cannot contain path components", () => {
  const filename = sanitizePdfFilename("..\\..\\private\\loan.pdf");
  assert.equal(filename, ".._.._private_loan.pdf");
  assert.doesNotMatch(filename, /[\\/]/);
});

test("valid text PDF is extracted, embedded, stored, and visible only to its owner", async () => {
  const database = new MockDatabase();
  const embedCalls = [];
  const url = await startTestServer(database, async (text, taskType) => {
    embedCalls.push({ text, taskType });
    return Array(768).fill(0.25);
  });
  const response = await postPdf(url, {
    filename: "..\\private\\fictional-policy.pdf",
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.document.filename, "fictional-policy.pdf");
  assert.doesNotMatch(result.document.filename, /[\\/]/);
  assert.equal(result.document.status, "ready");
  assert.equal(embedCalls.length, 1);
  assert.equal(embedCalls[0].taskType, "RETRIEVAL_DOCUMENT");
  assert.match(embedCalls[0].text, /Fictional loan policy/);
  assert.equal(database.chunks.length, 1);
  assert.equal(database.chunks[0].document_id, result.document.id);
  assert.equal(database.documents.get(result.document.id).user_id, userId);
  assert.equal(database.existingPolicyChunkCount, 7);

  const ownDocs = await fetch(url, { headers: { Authorization: `Bearer ${tokenFor(userId)}` } });
  const otherDocs = await fetch(url, { headers: { Authorization: `Bearer ${tokenFor(secondUserId)}` } });
  assert.equal((await ownDocs.json()).documents.length, 1);
  assert.equal((await otherDocs.json()).documents.length, 0);
});

test("upload rejects invalid file type and files over 5 MB", async () => {
  const url = await startTestServer(new MockDatabase());
  const wrongType = await postPdf(url, { filename: "notes.txt", type: "text/plain" });
  assert.equal(wrongType.status, 400);
  const tooLarge = await postPdf(url, {
    buffer: Buffer.concat([createPdf(), Buffer.alloc(MAX_UPLOAD_BYTES + 1)]),
  });
  assert.equal(tooLarge.status, 413);
});

test("upload rejects empty, unreadable, and textless PDFs", async () => {
  const url = await startTestServer(new MockDatabase());
  const empty = await postPdf(url, { buffer: Buffer.alloc(0) });
  assert.equal(empty.status, 400);
  const unreadable = await postPdf(url, { buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  assert.equal(unreadable.status, 422);
  const textless = await postPdf(url, { buffer: createPdf("") });
  assert.equal(textless.status, 422);
});

test("embedding failure marks the owned document failed and stores no chunks", async () => {
  const database = new MockDatabase();
  const url = await startTestServer(database, async () => {
    throw new Error("Simulated Gemini failure.");
  });
  const response = await postPdf(url);

  assert.equal(response.status, 500);
  assert.equal([...database.documents.values()][0].status, "failed");
  assert.equal(database.chunks.length, 0);
});

test("database failure rolls back chunks and does not mark the document ready", async () => {
  const database = new MockDatabase();
  database.failChunkInsert = true;
  const url = await startTestServer(database);
  const response = await postPdf(url);

  assert.equal(response.status, 500);
  assert.equal([...database.documents.values()][0].status, "failed");
  assert.equal(database.chunks.length, 0);
  assert.equal(database.existingPolicyChunkCount, 7);
});

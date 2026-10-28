CREATE TABLE uploaded_documents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type = 'application/pdf'),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  page_count INTEGER,
  chunk_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX uploaded_documents_user_created_idx
  ON uploaded_documents (user_id, created_at DESC);

ALTER TABLE document_chunks
  ADD COLUMN document_id UUID
  REFERENCES uploaded_documents(id) ON DELETE CASCADE;

CREATE INDEX document_chunks_document_id_idx
  ON document_chunks (document_id);

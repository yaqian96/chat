CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       VARCHAR(64)  NOT NULL,
  source        VARCHAR(16)  NOT NULL,
  source_id     VARCHAR(128) NOT NULL,
  title         TEXT         NOT NULL,
  file_name     TEXT,
  mime_type     VARCHAR(128),
  raw_path      TEXT,
  plain_text    TEXT,
  content_hash  VARCHAR(64) NOT NULL,
  folder_id     VARCHAR(128),
  language      VARCHAR(16),
  page_count    INT,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_user_source ON documents(user_id, source);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_user_folder ON documents(user_id, folder_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INT  NOT NULL,
  text          TEXT NOT NULL,
  token_count   INT  NOT NULL DEFAULT 0,
  chunk_type    VARCHAR(32) NOT NULL DEFAULT 'paragraph',
  heading_path  TEXT[] DEFAULT '{}',
  page_number   INT,
  chunk_hash    VARCHAR(64) NOT NULL,
  char_count    INT  NOT NULL,
  quality       VARCHAR(16) DEFAULT 'ok',
  embedding     vector(1536),
  embedded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON document_chunks(chunk_hash);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 256);

CREATE TABLE IF NOT EXISTS ingest_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       VARCHAR(64) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempt       INT  NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);

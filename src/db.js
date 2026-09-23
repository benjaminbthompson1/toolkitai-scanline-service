const { Pool } = require('pg');

// Scanline's own schema, in the same shared Postgres instance the platform
// and every other app service also use — separate schemas, one database.
const SCHEMA_NAME = process.env.PGSCHEMA || 'scanline';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
  options: `-c search_path=${SCHEMA_NAME},public`
});

// owner_id is a plain UUID column, NOT a foreign key to the platform's
// users table. In the monolith, that FK was straightforward because users
// and envelopes lived in one schema one service fully controlled; now
// users live in a separate service's schema that this service shouldn't
// assume permission to reference (and in a future move to a fully separate
// database per service, a cross-database FK wouldn't be possible at all).
// The tradeoff this accepts: deleting a platform account does not cascade
// to delete that person's scans here — they become orphaned rows, owned by
// a user id that no longer resolves. That's an acceptable, deliberate gap
// for a first cut; if it matters later, the platform can call this
// service's API to clean up on account deletion, or a scheduled job here
// can look for owner_ids the platform no longer has.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS scanline_documents (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  title TEXT NOT NULL,
  page_order UUID[] NOT NULL DEFAULT '{}',
  password_hash TEXT,
  ocr_text TEXT,
  ocr_generated_at TIMESTAMPTZ,
  summary_text TEXT,
  summary_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scanline_document_pages (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES scanline_documents(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  image_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scanline_documents_owner ON scanline_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_scanline_pages_document ON scanline_document_pages(document_id);
`;

async function ensureSchema() {
  await pool.query(SCHEMA);
}

module.exports = { pool, ensureSchema, SCHEMA_NAME };

# Scanline — document scanner (Toolkit AI app service)

Camera-based document/receipt/ID scanning: perspective-corrected crop, color/grayscale/B&W/enhance modes, batch capture, page reorder, signature/text/shape annotation, page numbering, PDF export, optional AI OCR/summarize, and an optional per-document password.

This is a standalone Toolkit AI **app service** — it owns no user accounts or login pages itself. It trusts the session issued by the separate **platform** service (`toolkitai-platform`), and stores only its own documents/pages in its own database schema. See that repo's `ARCHITECTURE.md` for the full cross-service contract (session sharing, Dokploy/Traefik routing, database grants) before deploying this.

## Environment variables

Required:
- `DATABASE_URL` — same Postgres instance the platform service uses
- `SESSION_SECRET` — **must exactly match** the platform service's value — this is what lets a login on the platform be recognized here
- `PLATFORM_SCHEMA` — the schema the platform service's shared session table lives in (defaults to `platform`)

Standard runtime:
- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=8080`

Optional:
- `PGSCHEMA` — defaults to `scanline`
- `PGSSL=require` — only if your Postgres needs TLS
- `PLATFORM_LOGIN_URL` — only set this if the platform service is on a different host/subdomain than this one; leave unset for the normal same-host, path-routed deployment (a relative `/login` already resolves correctly)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — enables the OCR/summarize buttons; without a key, Scanline works fully except those two, which the UI hides. Defaults to `claude-sonnet-5` if a key is set but no model is given.

## Local dev

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/toolkitai \
SESSION_SECRET=dev \
PLATFORM_SCHEMA=platform \
PORT=8080 HOST=0.0.0.0 node server.js
```

Note: for login to work locally, a platform service (or at least its `users`/`session` tables) needs to exist against the same `DATABASE_URL` first — Scanline's own session store expects that table to already be there (it never creates it itself).

## Structure

- `/scanline/` — the dashboard (requires the platform-issued session; unauthenticated visitors are redirected to the platform's `/login`).
- `/scanline/api/*` — REST API backing the dashboard. Every route requires a session, gated once at the top of `src/routes/scanline-api.js`.
- `/healthz` — checks DB connectivity, returns 200/503.

`scanline_documents.owner_id` is a plain UUID, not a foreign key — `users` lives in the platform service's own schema now. See `ARCHITECTURE.md` in the platform repo for why, and the accepted tradeoff that comes with it.

const crypto = require('crypto');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

// ============================================================
// THIS FILE MUST MATCH THE PLATFORM SERVICE'S src/auth.js
// sessionMiddleware() byte-for-byte in every value below (secret, cookie
// name, session table location, cookie path). It is a deliberate, manually
// kept copy rather than a shared import, because this is a separate
// deployable service/repo — see ARCHITECTURE.md at the platform repo root
// for the full contract this depends on. If you change one, change both.
//
// The key difference from the platform's copy: createTableIfMissing is
// false here — this service only ever reads/writes rows in a session table
// that the platform service already created and owns. Scanline's own
// Postgres role should be granted SELECT/INSERT/UPDATE/DELETE (not CREATE)
// on <PLATFORM_SCHEMA>.session — see the GRANT statement in README.md.
// ============================================================

// A separate, minimal pool just for the session store, pointed at the
// PLATFORM's schema — independent of this service's own db.js pool, which
// stays pointed at Scanline's own schema for its own tables.
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
  options: `-c search_path=${process.env.PLATFORM_SCHEMA || 'platform'},public`
});

function sessionMiddleware() {
  return session({
    store: new pgSession({ pool: sessionPool, schemaName: process.env.PLATFORM_SCHEMA || 'platform', tableName: 'session', createTableIfMissing: false }),
    name: 'toolkitai.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  });
}

// Relative by default (same-host, path-routed deployment — the normal
// case: Traefik sends /scanline/* here and everything else to the platform
// service on the same public hostname, so a plain "/login" already lands
// on the platform). Set PLATFORM_LOGIN_URL to a full URL only if the
// platform is on a different host/subdomain.
function loginUrl(nextPath) {
  const base = process.env.PLATFORM_LOGIN_URL || '/login';
  return `${base}?next=${encodeURIComponent(nextPath)}`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.originalUrl.includes('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect(loginUrl(req.originalUrl));
}

// ---------- local document-password hashing (Scanline's own "lock this
// scan" feature — unrelated to platform account passwords) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const suppliedBuffer = crypto.scryptSync(password, salt, 64);
    if (hashBuffer.length !== suppliedBuffer.length) return false;
    return crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
  } catch (e) {
    return false;
  }
}

module.exports = { sessionMiddleware, requireAuth, hashPassword, verifyPassword, sessionPool };

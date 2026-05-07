import pg from 'pg'

const { Pool } = pg

/** @type {pg.Pool | null} */
let pool = null

/**
 * Returns the shared connection pool.
 * Throws when DATABASE_URL is not configured.
 */
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })

    pool.on('error', (err) => {
      // Emit to stderr so container log drivers capture it.
      console.error(JSON.stringify({ level: 'error', message: 'pg pool error', error: err.message }))
    })
  }

  return pool
}

/**
 * Runs a parameterised query against the pool.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  return getPool().query(text, params)
}

/**
 * Applies all schema migrations idempotently.
 * This is intentionally a single function; add new ALTER / CREATE statements
 * below existing ones — never remove or reorder them.
 */
export async function migrate() {
  // tasks table
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT        NOT NULL,
      owner       TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Index so per-owner list queries are fast.
  await query(`
    CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner)
  `)

  // Durable audit event write-ahead store.
  await query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id            BIGSERIAL   PRIMARY KEY,
      event         TEXT        NOT NULL,
      metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      forwarded_at  TIMESTAMPTZ
    )
  `)

  await query(`
    CREATE INDEX IF NOT EXISTS audit_events_forwarded_idx
    ON audit_events (forwarded_at, created_at)
  `)
}

/**
 * Gracefully drains the pool.  Call on SIGTERM/SIGINT before exiting.
 */
export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

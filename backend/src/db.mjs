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
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT        NOT NULL,
      owner       TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await query(`
    CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner)
  `)

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

  await query(`
    CREATE TABLE IF NOT EXISTS intel_entries (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT        NOT NULL,
      details     TEXT        NOT NULL,
      priority    TEXT        NOT NULL,
      location    TEXT        NOT NULL,
      owner       TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await query(`
    CREATE INDEX IF NOT EXISTS intel_entries_owner_idx
    ON intel_entries (owner, created_at DESC)
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS profiles (
      owner                     TEXT        PRIMARY KEY,
      call_sign                 TEXT        NOT NULL,
      home_zone_id              TEXT        NOT NULL,
      pin_enabled               BOOLEAN     NOT NULL DEFAULT false,
      biometric_enabled         BOOLEAN     NOT NULL DEFAULT false,
      threat_override_enabled   BOOLEAN     NOT NULL DEFAULT false,
      stealth_mode_enabled      BOOLEAN     NOT NULL DEFAULT false,
      emergency_contacts        JSONB       NOT NULL DEFAULT '[]'::jsonb,
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

/**
 * Gracefully drains the pool. Call on SIGTERM/SIGINT before exiting.
 */
export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

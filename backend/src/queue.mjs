import PgBoss from 'pg-boss'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_SECONDS = 1
const USE_PG_BOSS = Boolean(process.env.DATABASE_URL)

/** @type {Map<string, (data: unknown) => Promise<void>>} */
const handlers = new Map()

/** @type {PgBoss | null} */
let boss = null

/** @type {((entry: Record<string, unknown>) => void) | null} */
let logHandler = null

function log(level, message, metadata = {}) {
  const entry = { level, message, ...metadata }
  if (logHandler) {
    logHandler(entry)
    return
  }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry))
}

function registerWorker(name, handler) {
  if (!boss) return
  boss.work(name, async (job) => {
    if (!job) return
    await handler(job.data)
  })
}

/**
 * Initializes the queue subsystem.
 * Uses pg-boss when DATABASE_URL is configured, with in-process fallback for local-only mode.
 * @param {{ logger?: (entry: Record<string, unknown>) => void }} [options]
 */
export async function startQueue(options = {}) {
  logHandler = options.logger ?? null

  if (!USE_PG_BOSS) {
    log('warn', 'DATABASE_URL not set — queue running in in-process fallback mode')
    return
  }

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: process.env.PG_BOSS_SCHEMA ?? 'pgboss',
  })

  await boss.start()
  for (const [name, handler] of handlers) {
    registerWorker(name, handler)
  }

  log('info', 'pg-boss queue started')
}

export async function stopQueue() {
  if (boss) {
    await boss.stop()
    boss = null
    log('info', 'pg-boss queue stopped')
  }
}

/**
 * Registers a handler for a named job type.
 * @param {string} name
 * @param {(data: unknown) => Promise<void>} handler
 */
export function registerJobHandler(name, handler) {
  handlers.set(name, handler)
  registerWorker(name, handler)
}

/**
 * Enqueues a job for asynchronous processing.
 * @param {string} name
 * @param {unknown} [data]
 */
export async function enqueue(name, data) {
  if (boss) {
    await boss.send(name, data, {
      retryLimit: MAX_ATTEMPTS,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
    })
    return
  }
  setImmediate(() => runFallback(name, data, 1))
}

async function runFallback(name, data, attempt) {
  const handler = handlers.get(name)
  if (!handler) {
    log('error', 'no handler registered for job', { job: name })
    return
  }

  try {
    await handler(data)
    log('info', 'job completed', { job: name, attempt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', 'job failed', { job: name, attempt, error: message })

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAY_SECONDS * 1_000 * 2 ** (attempt - 1)
      setTimeout(() => runFallback(name, data, attempt + 1), delay)
      return
    }

    log('error', 'job exhausted all retries', {
      job: name,
      maxAttempts: MAX_ATTEMPTS,
    })
  }
}

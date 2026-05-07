/**
 * Lightweight in-process job queue.
 *
 * Suitable for low-volume background work (email sending, audit flushes, etc.).
 * For high-throughput or durable jobs, replace this with a proper queue such
 * as BullMQ (Redis-backed) or pg-boss (PostgreSQL-backed).
 */

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1_000

/** @type {Map<string, (data: unknown) => Promise<void>>} */
const handlers = new Map()

/**
 * Registers a handler for a named job type.
 * @param {string} name
 * @param {(data: unknown) => Promise<void>} handler
 */
export function registerJobHandler(name, handler) {
  handlers.set(name, handler)
}

/**
 * Enqueues a job for asynchronous processing.
 * The job runs on the next event-loop iteration and will be retried
 * up to MAX_ATTEMPTS times with an exponential back-off on failure.
 *
 * @param {string} name  Registered job type name.
 * @param {unknown} [data]  Serialisable payload passed to the handler.
 */
export function enqueue(name, data) {
  // Schedule off the current call-stack so the HTTP response is not delayed.
  setImmediate(() => _run(name, data, 1))
}

async function _run(name, data, attempt) {
  const handler = handlers.get(name)

  if (!handler) {
    console.error(
      JSON.stringify({ level: 'error', message: 'no handler registered for job', job: name }),
    )
    return
  }

  try {
    await handler(data)
    console.log(JSON.stringify({ level: 'info', message: 'job completed', job: name, attempt }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({ level: 'error', message: 'job failed', job: name, attempt, error: message }),
    )

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * 2 ** (attempt - 1)
      setTimeout(() => _run(name, data, attempt + 1), delay)
    } else {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'job exhausted all retries',
          job: name,
          maxAttempts: MAX_ATTEMPTS,
        }),
      )
    }
  }
}

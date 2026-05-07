import { createServer } from 'node:http'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { migrate, query, closePool } from './db.mjs'
import { enqueue, registerJobHandler } from './queue.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 4000)
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS ?? 3600)
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? 300)
const STRIPE_WEBHOOK_MAX_FUTURE_SECONDS = Number(process.env.STRIPE_WEBHOOK_MAX_FUTURE_SECONDS ?? 60)
const FILE_BUCKET_BASE_URL = process.env.FILE_BUCKET_BASE_URL ?? 'https://example-bucket.local'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

// Rate-limit: requests per window per IP.
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 100)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'dev-secret-change-me')
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || (IS_PRODUCTION ? '' : 'whsec_dev')

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production')
}

if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET is required in production')
}

// Whether a real database is available (DATABASE_URL provided).
const DB_ENABLED = Boolean(process.env.DATABASE_URL)

// In-memory fallback tasks store (used when DATABASE_URL is not configured).
const memoryTasks = []

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

function log(level, message, metadata = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...metadata }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry))
}

/**
 * Emits an audit log entry for security-sensitive actions.
 * @param {string} event
 * @param {Record<string, unknown>} [metadata]
 */
function audit(event, metadata = {}) {
  log('info', 'audit', { event, ...metadata })
}

// ---------------------------------------------------------------------------
// JWT — HS256, three-part (header.payload.signature)
// ---------------------------------------------------------------------------

/**
 * Issues a signed HS256 JWT.
 * @param {string} subject  User identifier (e.g. email).
 * @param {'user' | 'admin'} [role]
 */
function issueToken(subject, role = 'user') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const nowMs = Date.now()
  const payloadObj = {
    sub: subject,
    role,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + TOKEN_TTL_SECONDS * 1000) / 1000),
  }
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

/**
 * Verifies a Bearer token and returns the decoded payload, or null on failure.
 * @param {string | undefined} authHeader
 * @returns {{ sub: string; role: string; exp: number; iat: number } | null}
 */
function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice('Bearer '.length)
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const signingInput = `${header}.${payload}`
  const expected = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url')

  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof decoded.exp !== 'number' || Date.now() >= decoded.exp * 1000) return null
    return decoded
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

/**
 * Returns true when the auth payload is present and includes one of the
 * required roles. Passing no roles means "authenticated only".
 * @param {{ role: string } | null} auth
 * @param {...string} roles
 */
function hasRole(auth, ...roles) {
  if (!auth) return false
  if (roles.length === 0) return true
  return roles.includes(auth.role)
}

// ---------------------------------------------------------------------------
// Rate limiting — in-memory sliding window per IP
// ---------------------------------------------------------------------------

/** @type {Map<string, number[]>} */
const rateLimitWindows = new Map()

function isRateLimited(ip) {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  let timestamps = (rateLimitWindows.get(ip) ?? []).filter((ts) => ts > windowStart)

  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitWindows.set(ip, timestamps)
    return true
  }

  timestamps.push(now)
  rateLimitWindows.set(ip, timestamps)
  return false
}

// Periodically evict stale rate-limit buckets to cap memory usage.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
  for (const [ip, timestamps] of rateLimitWindows) {
    const recent = timestamps.filter((ts) => ts > cutoff)
    if (recent.length === 0) {
      rateLimitWindows.delete(ip)
    } else {
      rateLimitWindows.set(ip, recent)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * @typedef {{ required?: boolean; type?: 'string' | 'number' | 'boolean'; maxLength?: number }} FieldRule
 */

/**
 * Validates a parsed request body against a simple schema.
 * Returns an array of human-readable error strings (empty = valid).
 * @param {Record<string, unknown>} body
 * @param {Record<string, FieldRule>} schema
 */
function validateBody(body, schema) {
  const errors = []
  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field]
    const missing = value === undefined || value === null || value === ''

    if (rules.required && missing) {
      errors.push(`${field} is required`)
      continue
    }

    if (!missing && rules.type && typeof value !== rules.type) {
      errors.push(`${field} must be a ${rules.type}`)
      continue
    }

    if (!missing && rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
      errors.push(`${field} must be at most ${rules.maxLength} characters`)
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function send(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Stripe-Signature',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(payload !== undefined ? JSON.stringify(payload) : '')
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => reject(new Error('Request stream error')))
  })
}

async function parseBody(req) {
  const raw = await parseRawBody(req)
  try {
    const body = raw.toString('utf8')
    return body ? JSON.parse(body) : {}
  } catch {
    throw new Error('Invalid JSON body')
  }
}

// ---------------------------------------------------------------------------
// Stripe signature verification
// ---------------------------------------------------------------------------

function parseStripeSignatureHeader(signatureHeader) {
  const items = signatureHeader.split(',').map((item) => item.trim())
  const timestampEntry = items.find((item) => item.startsWith('t='))
  const signatureEntry = items.find((item) => item.startsWith('v1='))

  if (!timestampEntry || !signatureEntry) return null

  const timestamp = Number(timestampEntry.slice(2))
  const signature = signatureEntry.slice(3)

  if (!Number.isFinite(timestamp) || !signature) return null
  return { timestamp, signature }
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false

  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed) return false

  const now = Math.floor(Date.now() / 1000)
  const ageInSeconds = now - parsed.timestamp
  const futureTimestampSeconds = parsed.timestamp - now

  if (
    ageInSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS ||
    futureTimestampSeconds > STRIPE_WEBHOOK_MAX_FUTURE_SECONDS
  ) {
    return false
  }

  const signedPayload = `${parsed.timestamp}.${rawBody.toString('utf8')}`
  const computed = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex')
  const left = Buffer.from(parsed.signature)
  const right = Buffer.from(computed)
  return left.length === right.length && timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------
// File name sanitisation
// ---------------------------------------------------------------------------

function sanitizeFileName(fileName) {
  const raw = String(fileName ?? '').trim()
  const extensionMatch = raw.match(/\.([a-zA-Z0-9]{1,8})$/)
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '.bin'
  const baseName = extensionMatch ? raw.slice(0, -extension.length) : raw
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
  const normalizedBaseName = safeBaseName || randomUUID()
  return `${normalizedBaseName.slice(0, 96)}${extension}`
}

// ---------------------------------------------------------------------------
// Task persistence helpers (DB-backed when DATABASE_URL is set, else memory)
// ---------------------------------------------------------------------------

async function dbListTasks(owner) {
  if (DB_ENABLED) {
    const result = await query(
      'SELECT id, title, owner, created_at FROM tasks WHERE owner = $1 ORDER BY created_at DESC',
      [owner],
    )
    return result.rows
  }
  return memoryTasks.filter((t) => t.owner === owner)
}

async function dbCreateTask(title, owner) {
  if (DB_ENABLED) {
    const result = await query(
      'INSERT INTO tasks (title, owner) VALUES ($1, $2) RETURNING id, title, owner, created_at',
      [title, owner],
    )
    return result.rows[0]
  }
  const task = { id: randomUUID(), title, owner, created_at: new Date().toISOString() }
  memoryTasks.unshift(task)
  return task
}

// ---------------------------------------------------------------------------
// Background job handlers
// ---------------------------------------------------------------------------

registerJobHandler('send-welcome-email', async (data) => {
  // TODO: integrate with your email provider (SendGrid, Resend, etc.)
  log('info', 'send-welcome-email job executed', { sub: data?.sub })
})

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const requestId = randomUUID()
  const clientIp = getClientIp(req)

  try {
    if (req.method === 'OPTIONS') {
      send(res, 204)
      return
    }

    // Apply rate limiting to every non-OPTIONS request.
    if (isRateLimited(clientIp)) {
      log('warn', 'rate limit exceeded', { requestId, ip: clientIp, path: req.url })
      send(res, 429, { error: 'too many requests' })
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/auth/login
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await parseBody(req)
      const errors = validateBody(body, {
        email: { required: true, type: 'string', maxLength: 254 },
      })

      if (errors.length) {
        send(res, 400, { error: errors[0] })
        return
      }

      const token = issueToken(body.email, 'user')
      audit('login', { requestId, sub: body.email, ip: clientIp })

      // Enqueue a post-login job (e.g. update last-seen timestamp, sync session).
      // This runs on every login. Rename or gate it behind a "new user" check when
      // you have a users table and can detect first-time logins.
      enqueue('send-welcome-email', { sub: body.email })

      send(res, 200, { token })
      return
    }

    const auth = verifyToken(req.headers.authorization)

    // -----------------------------------------------------------------------
    // GET /api/tasks
    // -----------------------------------------------------------------------
    if (req.url === '/api/tasks' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const tasks = await dbListTasks(auth.sub)
      send(res, 200, { tasks })
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/tasks
    // -----------------------------------------------------------------------
    if (req.url === '/api/tasks' && req.method === 'POST') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      const errors = validateBody(body, {
        title: { required: true, type: 'string', maxLength: 500 },
      })

      if (errors.length) {
        send(res, 400, { error: errors[0] })
        return
      }

      const task = await dbCreateTask(body.title.trim(), auth.sub)
      audit('task.create', { requestId, sub: auth.sub, taskId: task.id })
      send(res, 201, { task })
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/uploads/presign
    // -----------------------------------------------------------------------
    if (req.url === '/api/uploads/presign' && req.method === 'POST') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      const errors = validateBody(body, {
        fileName: { required: true, type: 'string', maxLength: 255 },
      })

      if (errors.length) {
        send(res, 400, { error: errors[0] })
        return
      }

      const fileName = sanitizeFileName(body.fileName)
      audit('upload.presign', { requestId, sub: auth.sub, fileName })
      send(res, 200, {
        uploadUrl: `${FILE_BUCKET_BASE_URL}/upload/${fileName}`,
        fileUrl: `${FILE_BUCKET_BASE_URL}/files/${fileName}`,
        expiresInSeconds: 300,
      })
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/webhooks/stripe
    // -----------------------------------------------------------------------
    if (req.url === '/api/webhooks/stripe' && req.method === 'POST') {
      const rawBody = await parseRawBody(req)
      const signature = req.headers['stripe-signature']

      if (!verifyStripeSignature(rawBody, typeof signature === 'string' ? signature : '')) {
        log('warn', 'stripe webhook signature invalid', { requestId, ip: clientIp })
        send(res, 400, { error: 'invalid signature' })
        return
      }

      // TODO: parse the Stripe event type and dispatch to appropriate handlers.
      audit('stripe.webhook', { requestId })
      send(res, 200, { received: true })
      return
    }

    send(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal server error'
    const statusCode = message === 'Invalid JSON body' ? 400 : 500

    log('error', 'request failed', {
      requestId,
      path: req.url,
      method: req.method,
      statusCode,
      error: message,
    })

    send(res, statusCode, { error: message, requestId })
  }
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  log('info', `received ${signal}, shutting down gracefully`)
  server.close(async () => {
    await closePool()
    log('info', 'shutdown complete')
    process.exit(0)
  })

  // Force exit after 10 s if server hasn't closed.
  setTimeout(() => {
    log('error', 'graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  if (DB_ENABLED) {
    log('info', 'applying database migrations')
    await migrate()
    log('info', 'database migrations complete')
  } else {
    log('warn', 'DATABASE_URL not set — using in-memory task storage (not suitable for production)')
  }

  server.listen(PORT, () => {
    log('info', 'StreetSmart backend listening', {
      port: PORT,
      environment: process.env.NODE_ENV ?? 'development',
      db: DB_ENABLED ? 'postgresql' : 'memory',
    })
  })
}

main().catch((err) => {
  log('error', 'startup failed', { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})

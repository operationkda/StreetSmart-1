import { createServer } from 'node:http'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { migrate, query, closePool } from './db.mjs'
import { enqueue, registerJobHandler, startQueue, stopQueue } from './queue.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 4000)
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS ?? 3600)
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? 300)
const STRIPE_WEBHOOK_MAX_FUTURE_SECONDS = Number(process.env.STRIPE_WEBHOOK_MAX_FUTURE_SECONDS ?? 60)
const FILE_BUCKET_BASE_URL = process.env.FILE_BUCKET_BASE_URL ?? 'https://example-bucket.local'
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME ?? ''
const FILE_BUCKET_REGION = process.env.FILE_BUCKET_REGION ?? ''
const FILE_BUCKET_ENDPOINT = process.env.FILE_BUCKET_ENDPOINT ?? ''
const FILE_BUCKET_KEY_PREFIX = process.env.FILE_BUCKET_KEY_PREFIX ?? 'uploads'
const FILE_BUCKET_PRESIGN_EXPIRES_SECONDS = Number(process.env.FILE_BUCKET_PRESIGN_EXPIRES_SECONDS ?? 300)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'
const VALID_AUTH_MODES = ['dev', 'oidc']
const AUTH_MODE = process.env.AUTH_MODE ?? (IS_PRODUCTION ? 'oidc' : 'dev')
const AUTH_OIDC_ISSUER = process.env.AUTH_OIDC_ISSUER ?? ''
const AUTH_OIDC_AUDIENCE = process.env.AUTH_OIDC_AUDIENCE ?? ''
const AUTH_OIDC_JWKS_URI =
  process.env.AUTH_OIDC_JWKS_URI ?? (AUTH_OIDC_ISSUER ? `${AUTH_OIDC_ISSUER}/.well-known/jwks.json` : '')
const AUTH_OIDC_ROLE_CLAIM = process.env.AUTH_OIDC_ROLE_CLAIM ?? 'role'
const AUTH_OIDC_ROLE_FALLBACK_CLAIM = 'https://streetsmart.io/role'
const DEV_ADMIN_EMAILS = new Set(
  String(process.env.DEV_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
)
const AUDIT_FORWARD_URL = process.env.AUDIT_FORWARD_URL ?? ''
const AUDIT_FORWARD_BATCH_SIZE = Number(process.env.AUDIT_FORWARD_BATCH_SIZE ?? 100)
const AUDIT_FORWARD_INTERVAL_MS = Number(process.env.AUDIT_FORWARD_INTERVAL_MS ?? 10_000)
const AUDIT_SPOOL_FILE_PATH = process.env.AUDIT_SPOOL_FILE_PATH ?? '/tmp/streetsmart-audit-events.ndjson'

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

if (!VALID_AUTH_MODES.includes(AUTH_MODE)) {
  throw new Error(`AUTH_MODE must be one of: ${VALID_AUTH_MODES.join(', ')}`)
}

if (AUTH_MODE === 'oidc' && (!AUTH_OIDC_ISSUER || !AUTH_OIDC_AUDIENCE)) {
  throw new Error('AUTH_OIDC_ISSUER and AUTH_OIDC_AUDIENCE are required when AUTH_MODE=oidc')
}

if (IS_PRODUCTION && AUTH_MODE === 'dev') {
  throw new Error('AUTH_MODE=dev is not allowed in production')
}

// Whether a real database is available (DATABASE_URL provided).
const DB_ENABLED = Boolean(process.env.DATABASE_URL)

// In-memory fallback tasks store (used when DATABASE_URL is not configured).
const memoryTasks = []

const jwks = AUTH_MODE === 'oidc' ? createRemoteJWKSet(new URL(AUTH_OIDC_JWKS_URI)) : null

const hasS3Config = Boolean(FILE_BUCKET_NAME && FILE_BUCKET_REGION)
const s3Client = hasS3Config
  ? new S3Client({
      region: FILE_BUCKET_REGION,
      ...(FILE_BUCKET_ENDPOINT ? { endpoint: FILE_BUCKET_ENDPOINT, forcePathStyle: true } : {}),
    })
  : null

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
async function audit(event, metadata = {}) {
  log('info', 'audit', { event, ...metadata })

  if (DB_ENABLED) {
    await query('INSERT INTO audit_events (event, metadata) VALUES ($1, $2::jsonb)', [
      event,
      JSON.stringify(metadata),
    ])
    return
  }

  const entry = { event, metadata, createdAt: new Date().toISOString() }
  await mkdir(dirname(AUDIT_SPOOL_FILE_PATH), { recursive: true })
  await appendFile(AUDIT_SPOOL_FILE_PATH, `${JSON.stringify(entry)}\n`, 'utf8')
}

function getRoleFromClaims(claims) {
  const value = claims[AUTH_OIDC_ROLE_CLAIM] ?? claims.role ?? claims[AUTH_OIDC_ROLE_FALLBACK_CLAIM]
  if (typeof value === 'string') return value === 'admin' ? 'admin' : 'user'
  if (Array.isArray(value) && value.includes('admin')) return 'admin'
  return 'user'
}

async function verifyOidcToken(token) {
  if (!jwks) throw new Error('OIDC not configured')

  const { payload } = await jwtVerify(token, jwks, {
    issuer: AUTH_OIDC_ISSUER,
    audience: AUTH_OIDC_AUDIENCE,
  })

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('provider token missing subject')
  }

  return { sub: payload.sub, role: getRoleFromClaims(payload) }
}

async function flushAuditForwarder() {
  if (!DB_ENABLED || !AUDIT_FORWARD_URL) return

  const result = await query(
    `
    SELECT id, event, metadata, created_at
    FROM audit_events
    WHERE forwarded_at IS NULL
    ORDER BY id ASC
    LIMIT $1
    `,
    [AUDIT_FORWARD_BATCH_SIZE],
  )

  if (!result.rows.length) return

  const response = await fetch(AUDIT_FORWARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'streetsmart-backend',
      events: result.rows.map((row) => ({
        id: row.id,
        event: row.event,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(`audit forwarder request failed with ${response.status}`)
  }

  const ids = result.rows.map((row) => row.id)
  await query('UPDATE audit_events SET forwarded_at = now() WHERE id = ANY($1::bigint[])', [ids])
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
 * @returns {{ sub: string; role: 'user' | 'admin'; exp: number; iat: number } | null}
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
    if (typeof decoded.sub !== 'string' || !decoded.sub) return null
    const role = decoded.role === 'admin' ? 'admin' : 'user'
    return { sub: decoded.sub, exp: decoded.exp, iat: Number(decoded.iat ?? 0), role }
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

/**
 * Fire-and-forget wrapper for async side effects.
 * Logs failures without interrupting the request-response cycle.
 * @param {Promise<unknown>} task
 * @param {string} taskName
 * @param {string} requestId
 */
function runAsyncTask(task, taskName, requestId) {
  task.catch((error) => {
    log('error', `${taskName} failed`, {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
  return task
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

async function createPresignedUpload(fileName, contentType) {
  if (!s3Client) {
    throw new Error('S3 presigning is not configured (set FILE_BUCKET_NAME and FILE_BUCKET_REGION)')
  }

  const keyPrefix = FILE_BUCKET_KEY_PREFIX.replace(/^\/+|\/+$/g, '')
  const key = keyPrefix ? `${keyPrefix}/${fileName}` : fileName
  const command = new PutObjectCommand({
    Bucket: FILE_BUCKET_NAME,
    Key: key,
    ...(typeof contentType === 'string' && contentType.trim()
      ? { ContentType: contentType.trim() }
      : {}),
  })

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: FILE_BUCKET_PRESIGN_EXPIRES_SECONDS,
  })

  return {
    uploadUrl,
    fileUrl: `${FILE_BUCKET_BASE_URL.replace(/\/$/, '')}/${key}`,
    expiresInSeconds: FILE_BUCKET_PRESIGN_EXPIRES_SECONDS,
  }
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

async function dbListAllTasks() {
  if (DB_ENABLED) {
    const result = await query('SELECT id, title, owner, created_at FROM tasks ORDER BY created_at DESC')
    return result.rows
  }
  return [...memoryTasks]
}

// ---------------------------------------------------------------------------
// Background job handlers
// ---------------------------------------------------------------------------

registerJobHandler('send-welcome-email', async (data) => {
  // TODO: integrate with your email provider (SendGrid, Resend, etc.)
  log('info', 'send-welcome-email job executed', { sub: data?.sub })
})
let auditForwarderInterval = null

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
      let sub = ''
      let role = 'user'

      if (AUTH_MODE === 'dev') {
        const errors = validateBody(body, {
          email: { required: true, type: 'string', maxLength: 254 },
        })
        if (errors.length) {
          send(res, 400, { error: errors[0] })
          return
        }
        sub = String(body.email).trim().toLowerCase()
        role = DEV_ADMIN_EMAILS.has(sub) ? 'admin' : 'user'
      } else {
        const errors = validateBody(body, {
          providerToken: { required: true, type: 'string', maxLength: 8192 },
        })
        if (errors.length) {
          send(res, 400, { error: errors[0] })
          return
        }
        const verified = await verifyOidcToken(String(body.providerToken))
        sub = verified.sub
        role = verified.role
      }

      const token = issueToken(sub, role)
      void runAsyncTask(audit('login', { requestId, sub, role, ip: clientIp }), 'audit log', requestId)

      // Enqueue a post-login job (e.g. update last-seen timestamp, sync session).
      // This runs on every login. Rename or gate it behind a "new user" check when
      // you have a users table and can detect first-time logins.
      void runAsyncTask(enqueue('send-welcome-email', { sub, role }), 'job enqueue', requestId)

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
      void runAsyncTask(
        audit('task.create', { requestId, sub: auth.sub, taskId: task.id }),
        'audit log',
        requestId,
      )
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
        contentType: { required: false, type: 'string', maxLength: 255 },
      })

      if (errors.length) {
        send(res, 400, { error: errors[0] })
        return
      }

      const fileName = sanitizeFileName(body.fileName)
      const presigned = await createPresignedUpload(fileName, body.contentType)
      void runAsyncTask(
        audit('upload.presign', { requestId, sub: auth.sub, fileName }),
        'audit log',
        requestId,
      )
      send(res, 200, presigned)
      return
    }

    // -----------------------------------------------------------------------
    // GET /api/admin/tasks
    // -----------------------------------------------------------------------
    if (req.url === '/api/admin/tasks' && req.method === 'GET') {
      if (!hasRole(auth, 'admin')) {
        send(res, 403, { error: 'forbidden' })
        return
      }
      const tasks = await dbListAllTasks()
      void runAsyncTask(
        audit('admin.tasks.list', { requestId, sub: auth.sub, count: tasks.length }),
        'audit log',
        requestId,
      )
      send(res, 200, { tasks })
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
      void runAsyncTask(audit('stripe.webhook', { requestId }), 'audit log', requestId)
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
    if (auditForwarderInterval) clearInterval(auditForwarderInterval)
    await stopQueue()
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

  await startQueue({
    logger: (entry) => log(entry.level ?? 'info', entry.message ?? 'queue event', entry),
  })

  auditForwarderInterval = setInterval(() => {
    void flushAuditForwarder().catch((error) => {
      log('error', 'audit flush failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, AUDIT_FORWARD_INTERVAL_MS)
  auditForwarderInterval.unref()

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

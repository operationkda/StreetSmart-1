import { createServer } from 'node:http'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { migrate, query, closePool } from './db.mjs'
import { enqueue, registerJobHandler, startQueue, stopQueue } from './queue.mjs'

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
const EMAIL_DELIVERY_MODE = process.env.EMAIL_DELIVERY_MODE ?? 'log'
const EMAIL_WEBHOOK_URL = process.env.EMAIL_WEBHOOK_URL ?? ''
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 100)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'dev-secret-change-me')
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || (IS_PRODUCTION ? '' : 'whsec_dev')
const DB_ENABLED = Boolean(process.env.DATABASE_URL)
const VALID_PRIORITIES = new Set(['low', 'moderate', 'high', 'critical'])

const ZONES = [
  {
    id: 'zone-harbor-safehouse',
    name: 'Harbor Safehouse',
    kind: 'safe',
    status: 'green',
    city: 'Savannah',
    radiusMeters: 450,
    lat: 32.0809,
    lng: -81.0912,
    notes: 'Primary regroup point with vehicle access and hardened comms.',
  },
  {
    id: 'zone-midtown-rally',
    name: 'Midtown Rally Point',
    kind: 'safe',
    status: 'amber',
    city: 'Savannah',
    radiusMeters: 250,
    lat: 32.0491,
    lng: -81.1035,
    notes: 'Secondary fallback if the harbor corridor is congested.',
  },
  {
    id: 'zone-riverfront-watch',
    name: 'Riverfront Watch Corridor',
    kind: 'danger',
    status: 'high-risk',
    city: 'Savannah',
    radiusMeters: 600,
    lat: 32.0835,
    lng: -81.0998,
    notes: 'Recent theft pattern and increased after-hours loitering.',
  },
  {
    id: 'zone-industrial-east',
    name: 'Industrial East Buffer',
    kind: 'danger',
    status: 'restricted',
    city: 'Savannah',
    radiusMeters: 700,
    lat: 32.0612,
    lng: -81.0493,
    notes: 'Avoid solo movement; maintain vehicle-only transit after dusk.',
  },
]

const ADVISORIES = [
  {
    id: 'adv-curfew-window',
    title: 'Curfew enforcement window expanded',
    severity: 'high',
    status: 'active',
    issuedAt: '2026-05-07T17:45:00.000Z',
    summary: 'Expect checkpoints and elevated patrol activity from 2100–0100 local time.',
    action: 'Complete essential travel before 2030 and stage fallback transport.',
  },
  {
    id: 'adv-network-interference',
    title: 'Cellular interference reported downtown',
    severity: 'medium',
    status: 'active',
    issuedAt: '2026-05-07T18:20:00.000Z',
    summary: 'Intermittent LTE degradation may affect app alerts and call quality.',
    action: 'Cache offline routes and confirm alternate comms with your primary contact.',
  },
  {
    id: 'adv-harbor-open',
    title: 'Harbor evacuation lane remains open',
    severity: 'low',
    status: 'monitoring',
    issuedAt: '2026-05-07T19:05:00.000Z',
    summary: 'Port authority cleared inbound traffic queue for light vehicles.',
    action: 'Keep Harbor Safehouse as the preferred extraction destination.',
  },
]

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

const memoryIntelEntries = []
const memoryProfiles = new Map()
const jwks = AUTH_MODE === 'oidc' ? createRemoteJWKSet(new URL(AUTH_OIDC_JWKS_URI)) : null
const hasS3Config = Boolean(FILE_BUCKET_NAME && FILE_BUCKET_REGION)
const s3Client = hasS3Config
  ? new S3Client({
      region: FILE_BUCKET_REGION,
      ...(FILE_BUCKET_ENDPOINT ? { endpoint: FILE_BUCKET_ENDPOINT, forcePathStyle: true } : {}),
    })
  : null

function log(level, message, metadata = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...metadata }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry))
}

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

function hasRole(auth, ...roles) {
  if (!auth) return false
  if (roles.length === 0) return true
  return roles.includes(auth.role)
}

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

function normalizePriority(priority) {
  const normalized = String(priority ?? '').trim().toLowerCase()
  return VALID_PRIORITIES.has(normalized) ? normalized : 'moderate'
}

function sanitizeIntelEntry(row) {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    priority: normalizePriority(row.priority),
    location: row.location,
    owner: row.owner,
    created_at: row.created_at,
  }
}

function buildDefaultProfile(owner) {
  const callSignSource = owner.includes('@') ? owner.split('@')[0] : owner
  return {
    owner,
    call_sign: callSignSource.replace(/[^a-zA-Z0-9]/g, ' ').trim().toUpperCase() || 'OPERATOR',
    home_zone_id: 'zone-harbor-safehouse',
    pin_enabled: false,
    biometric_enabled: false,
    threat_override_enabled: false,
    stealth_mode_enabled: false,
    emergency_contacts: [
      {
        name: 'Primary contact',
        phone: '+1-555-0101',
        relationship: 'trusted ally',
      },
    ],
    updated_at: new Date().toISOString(),
  }
}

function sanitizeProfileRow(row) {
  return {
    owner: row.owner,
    call_sign: row.call_sign,
    home_zone_id: row.home_zone_id,
    pin_enabled: Boolean(row.pin_enabled),
    biometric_enabled: Boolean(row.biometric_enabled),
    threat_override_enabled: Boolean(row.threat_override_enabled),
    stealth_mode_enabled: Boolean(row.stealth_mode_enabled),
    emergency_contacts: Array.isArray(row.emergency_contacts) ? row.emergency_contacts : [],
    updated_at: row.updated_at,
  }
}

function normalizeEmergencyContacts(value) {
  if (!Array.isArray(value)) {
    throw new Error('emergencyContacts must be an array')
  }

  if (value.length > 5) {
    throw new Error('emergencyContacts must contain at most 5 contacts')
  }

  return value.map((contact, index) => {
    if (!contact || typeof contact !== 'object' || Array.isArray(contact)) {
      throw new Error(`emergencyContacts[${index}] must be an object`)
    }

    const name = String(contact.name ?? '').trim()
    const phone = String(contact.phone ?? '').trim()
    const relationship = String(contact.relationship ?? '').trim()

    if (!name) {
      throw new Error(`emergencyContacts[${index}].name is required`)
    }

    if (!phone) {
      throw new Error(`emergencyContacts[${index}].phone is required`)
    }

    if (name.length > 120 || phone.length > 120 || relationship.length > 120) {
      throw new Error(`emergencyContacts[${index}] fields must be at most 120 characters`)
    }

    return {
      name,
      phone,
      relationship,
    }
  })
}

function normalizeProfileUpdate(body) {
  const errors = validateBody(body, {
    callSign: { required: true, type: 'string', maxLength: 80 },
    homeZoneId: { required: true, type: 'string', maxLength: 80 },
    pinEnabled: { required: true, type: 'boolean' },
    biometricEnabled: { required: true, type: 'boolean' },
    threatOverrideEnabled: { required: true, type: 'boolean' },
    stealthModeEnabled: { required: true, type: 'boolean' },
  })

  if (errors.length) {
    throw new Error(errors[0])
  }

  const zoneExists = ZONES.some((zone) => zone.id === body.homeZoneId)
  if (!zoneExists) {
    throw new Error('homeZoneId must reference a known zone')
  }

  return {
    call_sign: String(body.callSign).trim(),
    home_zone_id: String(body.homeZoneId).trim(),
    pin_enabled: Boolean(body.pinEnabled),
    biometric_enabled: Boolean(body.biometricEnabled),
    threat_override_enabled: Boolean(body.threatOverrideEnabled),
    stealth_mode_enabled: Boolean(body.stealthModeEnabled),
    emergency_contacts: normalizeEmergencyContacts(body.emergencyContacts ?? []),
  }
}

async function dbListIntelEntries(owner) {
  if (DB_ENABLED) {
    const result = await query(
      `
      SELECT id, title, details, priority, location, owner, created_at
      FROM intel_entries
      WHERE owner = $1
      ORDER BY created_at DESC
      `,
      [owner],
    )
    return result.rows.map(sanitizeIntelEntry)
  }

  return memoryIntelEntries.filter((entry) => entry.owner === owner)
}

async function dbCreateIntelEntry({ title, details, priority, location }, owner) {
  if (DB_ENABLED) {
    const result = await query(
      `
      INSERT INTO intel_entries (title, details, priority, location, owner)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, details, priority, location, owner, created_at
      `,
      [title, details, priority, location, owner],
    )
    return sanitizeIntelEntry(result.rows[0])
  }

  const intel = {
    id: randomUUID(),
    title,
    details,
    priority,
    location,
    owner,
    created_at: new Date().toISOString(),
  }
  memoryIntelEntries.unshift(intel)
  return intel
}

async function dbDeleteIntelEntry(id, owner) {
  if (DB_ENABLED) {
    const result = await query('DELETE FROM intel_entries WHERE id = $1 AND owner = $2 RETURNING id', [id, owner])
    return result.rowCount > 0
  }

  const index = memoryIntelEntries.findIndex((entry) => entry.id === id && entry.owner === owner)
  if (index === -1) return false
  memoryIntelEntries.splice(index, 1)
  return true
}

async function dbListAllIntelEntries(limit = 12) {
  if (DB_ENABLED) {
    const result = await query(
      `
      SELECT id, title, details, priority, location, owner, created_at
      FROM intel_entries
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit],
    )
    return result.rows.map(sanitizeIntelEntry)
  }

  return [...memoryIntelEntries].slice(0, limit)
}

async function dbGetIntelStats() {
  if (DB_ENABLED) {
    const result = await query(
      `
      SELECT
        COUNT(*)::int AS total_reports,
        COUNT(*) FILTER (WHERE priority IN ('high', 'critical'))::int AS urgent_reports
      FROM intel_entries
      `,
    )
    return result.rows[0] ?? { total_reports: 0, urgent_reports: 0 }
  }

  return {
    total_reports: memoryIntelEntries.length,
    urgent_reports: memoryIntelEntries.filter((entry) => ['high', 'critical'].includes(entry.priority)).length,
  }
}

async function dbGetProfile(owner) {
  if (DB_ENABLED) {
    const result = await query(
      `
      INSERT INTO profiles (owner, call_sign, home_zone_id, emergency_contacts)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (owner) DO NOTHING
      RETURNING owner, call_sign, home_zone_id, pin_enabled, biometric_enabled,
                threat_override_enabled, stealth_mode_enabled, emergency_contacts, updated_at
      `,
      [
        owner,
        buildDefaultProfile(owner).call_sign,
        buildDefaultProfile(owner).home_zone_id,
        JSON.stringify(buildDefaultProfile(owner).emergency_contacts),
      ],
    )

    if (result.rows[0]) {
      return sanitizeProfileRow(result.rows[0])
    }

    const existing = await query(
      `
      SELECT owner, call_sign, home_zone_id, pin_enabled, biometric_enabled,
             threat_override_enabled, stealth_mode_enabled, emergency_contacts, updated_at
      FROM profiles
      WHERE owner = $1
      `,
      [owner],
    )
    return sanitizeProfileRow(existing.rows[0])
  }

  if (!memoryProfiles.has(owner)) {
    memoryProfiles.set(owner, buildDefaultProfile(owner))
  }
  return memoryProfiles.get(owner)
}

async function dbUpsertProfile(owner, profile) {
  if (DB_ENABLED) {
    const result = await query(
      `
      INSERT INTO profiles (
        owner, call_sign, home_zone_id, pin_enabled, biometric_enabled,
        threat_override_enabled, stealth_mode_enabled, emergency_contacts, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      ON CONFLICT (owner) DO UPDATE
      SET call_sign = EXCLUDED.call_sign,
          home_zone_id = EXCLUDED.home_zone_id,
          pin_enabled = EXCLUDED.pin_enabled,
          biometric_enabled = EXCLUDED.biometric_enabled,
          threat_override_enabled = EXCLUDED.threat_override_enabled,
          stealth_mode_enabled = EXCLUDED.stealth_mode_enabled,
          emergency_contacts = EXCLUDED.emergency_contacts,
          updated_at = now()
      RETURNING owner, call_sign, home_zone_id, pin_enabled, biometric_enabled,
                threat_override_enabled, stealth_mode_enabled, emergency_contacts, updated_at
      `,
      [
        owner,
        profile.call_sign,
        profile.home_zone_id,
        profile.pin_enabled,
        profile.biometric_enabled,
        profile.threat_override_enabled,
        profile.stealth_mode_enabled,
        JSON.stringify(profile.emergency_contacts),
      ],
    )
    return sanitizeProfileRow(result.rows[0])
  }

  const updated = {
    owner,
    ...profile,
    updated_at: new Date().toISOString(),
  }
  memoryProfiles.set(owner, updated)
  return updated
}

async function buildBriefing(sub) {
  const profile = await dbGetProfile(sub)
  const intelEntries = await dbListIntelEntries(sub)
  const urgentIntelCount = intelEntries.filter((entry) => ['high', 'critical'].includes(entry.priority)).length
  const activeAdvisories = ADVISORIES.filter((advisory) => advisory.status !== 'resolved')
  const safeZones = ZONES.filter((zone) => zone.kind === 'safe')
  const dangerZones = ZONES.filter((zone) => zone.kind === 'danger')
  const homeZone = ZONES.find((zone) => zone.id === profile.home_zone_id) ?? safeZones[0] ?? null

  return {
    threatLevel: urgentIntelCount > 0 || activeAdvisories.some((item) => item.severity === 'high') ? 'elevated' : 'guarded',
    headline: 'Operational picture refreshed for the next movement window.',
    summary:
      urgentIntelCount > 0
        ? 'You have urgent intel entries on file. Coordinate movement through safe corridors only.'
        : 'No urgent field reports in your personal log. Continue monitoring advisories and movement corridors.',
    nextCheckInAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    safeZoneCount: safeZones.length,
    dangerZoneCount: dangerZones.length,
    activeAdvisoryCount: activeAdvisories.length,
    intelReportCount: intelEntries.length,
    urgentIntelCount,
    homeZone,
    securityPosture: {
      callSign: profile.call_sign,
      pinEnabled: profile.pin_enabled,
      biometricEnabled: profile.biometric_enabled,
      threatOverrideEnabled: profile.threat_override_enabled,
      stealthModeEnabled: profile.stealth_mode_enabled,
      emergencyContactCount: profile.emergency_contacts.length,
    },
  }
}

async function deliverSecurityBriefing(data) {
  const payload = {
    type: 'security-briefing',
    sub: data?.sub,
    role: data?.role,
    dispatchedAt: new Date().toISOString(),
  }

  if (EMAIL_DELIVERY_MODE === 'webhook') {
    if (!EMAIL_WEBHOOK_URL) {
      throw new Error('EMAIL_WEBHOOK_URL is required when EMAIL_DELIVERY_MODE=webhook')
    }

    const response = await fetch(EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`briefing delivery failed with ${response.status}`)
    }

    log('info', 'security briefing delivered', { sub: data?.sub, delivery: 'webhook' })
    return
  }

  log('info', 'security briefing queued in log mode', payload)
}

registerJobHandler('dispatch-security-briefing', async (data) => {
  await deliverSecurityBriefing(data)
})

function parseStripeEvent(rawBody) {
  try {
    const event = JSON.parse(rawBody.toString('utf8'))
    return typeof event === 'object' && event ? event : null
  } catch {
    return null
  }
}

let auditForwarderInterval = null

const server = createServer(async (req, res) => {
  const requestId = randomUUID()
  const clientIp = getClientIp(req)

  try {
    if (req.method === 'OPTIONS') {
      send(res, 204)
      return
    }

    if (isRateLimited(clientIp)) {
      log('warn', 'rate limit exceeded', { requestId, ip: clientIp, path: req.url })
      send(res, 429, { error: 'too many requests' })
      return
    }

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
      void runAsyncTask(enqueue('dispatch-security-briefing', { sub, role }), 'job enqueue', requestId)
      send(res, 200, { token })
      return
    }

    const auth = verifyToken(req.headers.authorization)

    if (req.url === '/api/briefing' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const briefing = await buildBriefing(auth.sub)
      send(res, 200, { briefing })
      return
    }

    if (req.url === '/api/zones' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      send(res, 200, { zones: ZONES })
      return
    }

    if (req.url === '/api/advisories' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      send(res, 200, { advisories: ADVISORIES })
      return
    }

    if (req.url === '/api/intel' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const intel = await dbListIntelEntries(auth.sub)
      send(res, 200, { intel })
      return
    }

    if (req.url === '/api/intel' && req.method === 'POST') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      const errors = validateBody(body, {
        title: { required: true, type: 'string', maxLength: 120 },
        details: { required: true, type: 'string', maxLength: 2000 },
        priority: { required: true, type: 'string', maxLength: 20 },
        location: { required: true, type: 'string', maxLength: 120 },
      })

      if (errors.length) {
        send(res, 400, { error: errors[0] })
        return
      }

      const intel = await dbCreateIntelEntry(
        {
          title: String(body.title).trim(),
          details: String(body.details).trim(),
          priority: normalizePriority(body.priority),
          location: String(body.location).trim(),
        },
        auth.sub,
      )
      void runAsyncTask(
        audit('intel.create', { requestId, sub: auth.sub, intelId: intel.id, priority: intel.priority }),
        'audit log',
        requestId,
      )
      send(res, 201, { intel })
      return
    }

    const deleteIntelMatch = req.url?.match(/^\/api\/intel\/([^/?]+)$/)
    if (deleteIntelMatch && req.method === 'DELETE') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const intelId = deleteIntelMatch[1]
      const deleted = await dbDeleteIntelEntry(intelId, auth.sub)
      if (!deleted) {
        send(res, 404, { error: 'not found' })
        return
      }

      void runAsyncTask(audit('intel.delete', { requestId, sub: auth.sub, intelId }), 'audit log', requestId)
      send(res, 204)
      return
    }

    if (req.url === '/api/profile' && req.method === 'GET') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const profile = await dbGetProfile(auth.sub)
      send(res, 200, { profile })
      return
    }

    if (req.url === '/api/profile' && req.method === 'PUT') {
      if (!hasRole(auth)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      const profileUpdate = normalizeProfileUpdate(body)
      const profile = await dbUpsertProfile(auth.sub, profileUpdate)
      void runAsyncTask(
        audit('profile.update', {
          requestId,
          sub: auth.sub,
          homeZoneId: profile.home_zone_id,
          stealthModeEnabled: profile.stealth_mode_enabled,
        }),
        'audit log',
        requestId,
      )
      send(res, 200, { profile })
      return
    }

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

    if (req.url === '/api/admin/overview' && req.method === 'GET') {
      if (!hasRole(auth, 'admin')) {
        send(res, 403, { error: 'forbidden' })
        return
      }

      const recentIntel = await dbListAllIntelEntries(12)
      const intelStats = await dbGetIntelStats()
      void runAsyncTask(
        audit('admin.overview.view', { requestId, sub: auth.sub, count: recentIntel.length }),
        'audit log',
        requestId,
      )
      send(res, 200, {
        overview: {
          totalIntelReports: Number(intelStats.total_reports ?? 0),
          urgentIntelReports: Number(intelStats.urgent_reports ?? 0),
          activeAdvisories: ADVISORIES.filter((advisory) => advisory.status !== 'resolved').length,
          dangerZones: ZONES.filter((zone) => zone.kind === 'danger').length,
          recommendedAction: 'Prioritize route reviews, urgent report triage, and after-dark movement restrictions.',
        },
        recentIntel,
      })
      return
    }

    if (req.url === '/api/webhooks/stripe' && req.method === 'POST') {
      const rawBody = await parseRawBody(req)
      const signature = req.headers['stripe-signature']

      if (!verifyStripeSignature(rawBody, typeof signature === 'string' ? signature : '')) {
        log('warn', 'stripe webhook signature invalid', { requestId, ip: clientIp })
        send(res, 400, { error: 'invalid signature' })
        return
      }

      const event = parseStripeEvent(rawBody)
      const eventType = typeof event?.type === 'string' ? event.type : 'unknown'
      const auditEvent =
        eventType === 'payment_intent.succeeded' ? 'stripe.payment_intent.succeeded' : 'stripe.webhook.unhandled'
      void runAsyncTask(audit(auditEvent, { requestId, eventType }), 'audit log', requestId)
      send(res, 200, { received: true, eventType })
      return
    }

    send(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal server error'
    const statusCode =
      message === 'Invalid JSON body' || /required|must be|known zone|at most/.test(message) ? 400 : 500

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

async function shutdown(signal) {
  log('info', `received ${signal}, shutting down gracefully`)
  server.close(async () => {
    if (auditForwarderInterval) clearInterval(auditForwarderInterval)
    await stopQueue()
    await closePool()
    log('info', 'shutdown complete')
    process.exit(0)
  })

  setTimeout(() => {
    log('error', 'graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

async function main() {
  if (DB_ENABLED) {
    log('info', 'applying database migrations')
    await migrate()
    log('info', 'database migrations complete')
  } else {
    log('warn', 'DATABASE_URL not set — using in-memory StreetSmart stores (not suitable for production)')
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
      authMode: AUTH_MODE,
    })
  })
}

main().catch((err) => {
  log('error', 'startup failed', { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})

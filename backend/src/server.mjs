import { createServer } from 'node:http'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 4000)
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS ?? 3600)
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? 300)
const STRIPE_WEBHOOK_MAX_FUTURE_SECONDS = Number(process.env.STRIPE_WEBHOOK_MAX_FUTURE_SECONDS ?? 60)
const FILE_BUCKET_BASE_URL = process.env.FILE_BUCKET_BASE_URL ?? 'https://example-bucket.local'

const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'dev-secret-change-me')
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || (IS_PRODUCTION ? '' : 'whsec_dev')

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production')
}

if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET is required in production')
}

function log(level, message, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry))
}

// TODO: Replace with persistent database storage before production deployment.
// Prototype-only storage: in-memory array is not durable and not safe for horizontal scaling.
const tasks = []

function send(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Stripe-Signature',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(payload ? JSON.stringify(payload) : '')
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

function issueToken(subject) {
  const nowMs = Date.now()
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor((nowMs + TOKEN_TTL_SECONDS * 1000) / 1000),
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.slice('Bearer '.length)
  const [payload, signature] = token.split('.')
  if (!payload || !signature) {
    return null
  }

  const expected = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof decoded.exp !== 'number' || Date.now() >= decoded.exp * 1000) {
      return null
    }

    return decoded
  } catch {
    return null
  }
}

function parseStripeSignatureHeader(signatureHeader) {
  const items = signatureHeader.split(',').map((item) => item.trim())
  const timestampEntry = items.find((item) => item.startsWith('t='))
  const signatureEntry = items.find((item) => item.startsWith('v1='))

  if (!timestampEntry || !signatureEntry) {
    return null
  }

  const timestamp = Number(timestampEntry.slice(2))
  const signature = signatureEntry.slice(3)

  if (!Number.isFinite(timestamp) || !signature) {
    return null
  }

  return { timestamp, signature }
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
    return false
  }

  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  const ageInSeconds = now - parsed.timestamp
  const futureTimestampSeconds = parsed.timestamp - now

  if (ageInSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS || futureTimestampSeconds > STRIPE_WEBHOOK_MAX_FUTURE_SECONDS) {
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

const server = createServer(async (req, res) => {
  const requestId = randomUUID()

  try {
    if (req.method === 'OPTIONS') {
      send(res, 204)
      return
    }

    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await parseBody(req)
      if (!body.email) {
        send(res, 400, { error: 'email is required' })
        return
      }

      send(res, 200, { token: issueToken(body.email) })
      return
    }

    const auth = verifyToken(req.headers.authorization)

    if (req.url === '/api/tasks' && req.method === 'GET') {
      if (!auth) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      send(res, 200, { tasks: tasks.filter((task) => task.owner === auth.sub) })
      return
    }

    if (req.url === '/api/tasks' && req.method === 'POST') {
      if (!auth) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      if (!body.title) {
        send(res, 400, { error: 'title is required' })
        return
      }

      const task = { id: randomUUID(), title: body.title, owner: auth.sub }
      tasks.unshift(task)
      send(res, 201, { task })
      return
    }

    if (req.url === '/api/uploads/presign' && req.method === 'POST') {
      if (!auth) {
        send(res, 401, { error: 'unauthorized' })
        return
      }

      const body = await parseBody(req)
      const fileName = sanitizeFileName(body.fileName)
      send(res, 200, {
        uploadUrl: `${FILE_BUCKET_BASE_URL}/upload/${fileName}`,
        fileUrl: `${FILE_BUCKET_BASE_URL}/files/${fileName}`,
        expiresInSeconds: 300,
      })
      return
    }

    if (req.url === '/api/webhooks/stripe' && req.method === 'POST') {
      const rawBody = await parseRawBody(req)
      const signature = req.headers['stripe-signature']

      if (!verifyStripeSignature(rawBody, typeof signature === 'string' ? signature : '')) {
        send(res, 400, { error: 'invalid signature' })
        return
      }

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

server.listen(PORT, () => {
  log('info', 'StreetSmart backend listening', { port: PORT, environment: process.env.NODE_ENV ?? 'development' })
})

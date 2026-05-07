import { randomUUID } from 'node:crypto'

const BASE_URL = (process.env.UAT_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '')
const AUTH_MODE = process.env.UAT_AUTH_MODE ?? 'dev'
const DEV_EMAIL = process.env.UAT_DEV_EMAIL ?? 'admin@example.com'
const OIDC_PROVIDER_TOKEN = process.env.UAT_OIDC_PROVIDER_TOKEN ?? ''
const ADMIN_EXPECTED_STATUS = Number(process.env.UAT_ADMIN_EXPECTED_STATUS ?? 200)
const REQUEST_TIMEOUT_MS = Number(process.env.UAT_TIMEOUT_MS ?? 10_000)
// Guardrail for clearly malformed tokens while avoiding strict JWT parsing in smoke tests.
const MIN_JWT_CHAR_THRESHOLD_FOR_HEADER_PAYLOAD = 50

function assert(condition, message, metadata = {}) {
  if (condition) return
  const error = new Error(message)
  error.metadata = metadata
  throw error
}

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { response, body }
  } finally {
    clearTimeout(timeout)
  }
}

async function run() {
  assert(['dev', 'oidc'].includes(AUTH_MODE), 'UAT_AUTH_MODE must be dev or oidc', { AUTH_MODE })
  if (AUTH_MODE === 'oidc') {
    assert(Boolean(OIDC_PROVIDER_TOKEN), 'UAT_OIDC_PROVIDER_TOKEN is required in oidc mode')
  }

  const loginPayload =
    AUTH_MODE === 'dev' ? { email: DEV_EMAIL } : { providerToken: OIDC_PROVIDER_TOKEN }

  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginPayload),
  })
  assert(loginResult.response.status === 200, 'login failed', {
    status: loginResult.response.status,
    body: loginResult.body,
  })
  const token = loginResult.body?.token
  assert(
    typeof token === 'string' && token.length > MIN_JWT_CHAR_THRESHOLD_FOR_HEADER_PAYLOAD,
    'login did not return a valid token',
  )
  console.log(JSON.stringify({ level: 'info', check: 'auth.login', status: 'ok' }))

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const listBefore = await request('/api/tasks', { method: 'GET', headers: authHeaders })
  assert(listBefore.response.status === 200, 'task list before create failed', {
    status: listBefore.response.status,
    body: listBefore.body,
  })
  assert(Array.isArray(listBefore.body?.tasks), 'task list response missing tasks array', {
    body: listBefore.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'tasks.list.before', status: 'ok' }))

  const uniqueTitle = `uat-${Date.now()}-${randomUUID().slice(0, 8)}`
  const createResult = await request('/api/tasks', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title: uniqueTitle }),
  })
  assert(createResult.response.status === 201, 'task create failed', {
    status: createResult.response.status,
    body: createResult.body,
  })
  assert(typeof createResult.body?.task?.id === 'string', 'task create did not return id', {
    body: createResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'tasks.create', status: 'ok' }))

  const listAfter = await request('/api/tasks', { method: 'GET', headers: authHeaders })
  assert(listAfter.response.status === 200, 'task list after create failed', {
    status: listAfter.response.status,
    body: listAfter.body,
  })
  const createdTaskPresent = (listAfter.body?.tasks ?? []).some((task) => task?.title === uniqueTitle)
  assert(createdTaskPresent, 'created task is not present in list results')
  console.log(JSON.stringify({ level: 'info', check: 'tasks.list.after', status: 'ok' }))

  const adminListResult = await request('/api/admin/tasks', {
    method: 'GET',
    headers: authHeaders,
  })
  assert(adminListResult.response.status === ADMIN_EXPECTED_STATUS, 'admin RBAC check failed', {
    expected: ADMIN_EXPECTED_STATUS,
    actual: adminListResult.response.status,
    body: adminListResult.body,
  })
  console.log(
    JSON.stringify({
      level: 'info',
      check: 'admin.tasks',
      status: 'ok',
      expectedStatus: ADMIN_EXPECTED_STATUS,
    }),
  )

  const presignResult = await request('/api/uploads/presign', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fileName: 'uat-proof.txt',
      contentType: 'text/plain',
    }),
  })
  assert(presignResult.response.status === 200, 'upload presign failed', {
    status: presignResult.response.status,
    body: presignResult.body,
  })
  assert(typeof presignResult.body?.uploadUrl === 'string', 'upload presign missing uploadUrl', {
    body: presignResult.body,
  })
  assert(typeof presignResult.body?.fileUrl === 'string', 'upload presign missing fileUrl', {
    body: presignResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'uploads.presign', status: 'ok' }))

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'uat smoke completed',
      baseUrl: BASE_URL,
      authMode: AUTH_MODE,
    }),
  )
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
      metadata: error?.metadata ?? {},
    }),
  )
  process.exit(1)
})

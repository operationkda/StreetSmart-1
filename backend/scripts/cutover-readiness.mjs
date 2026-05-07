const BASE_URL = (process.env.CUTOVER_BASE_URL ?? '').replace(/\/$/, '')
const AUTH_MODE = process.env.CUTOVER_AUTH_MODE ?? 'dev'
const DEV_EMAIL = process.env.CUTOVER_DEV_EMAIL ?? 'admin@example.com'
const OIDC_PROVIDER_TOKEN = process.env.CUTOVER_OIDC_PROVIDER_TOKEN ?? ''
const ADMIN_EXPECTED_STATUS = Number(process.env.CUTOVER_ADMIN_EXPECTED_STATUS ?? 200)
const REQUEST_TIMEOUT_MS = Number(process.env.CUTOVER_TIMEOUT_MS ?? 10_000)
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
  assert(Boolean(BASE_URL), 'CUTOVER_BASE_URL is required')
  assert(['dev', 'oidc'].includes(AUTH_MODE), 'CUTOVER_AUTH_MODE must be dev or oidc', { AUTH_MODE })
  if (AUTH_MODE === 'oidc') {
    assert(Boolean(OIDC_PROVIDER_TOKEN), 'CUTOVER_OIDC_PROVIDER_TOKEN is required in oidc mode')
  }

  const loginPayload = AUTH_MODE === 'dev' ? { email: DEV_EMAIL } : { providerToken: OIDC_PROVIDER_TOKEN }
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

  const briefingResult = await request('/api/briefing', { method: 'GET', headers: authHeaders })
  assert(briefingResult.response.status === 200, 'briefing request failed', {
    status: briefingResult.response.status,
    body: briefingResult.body,
  })
  assert(typeof briefingResult.body?.briefing?.headline === 'string', 'briefing payload missing headline', {
    body: briefingResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'briefing.read', status: 'ok' }))

  const advisoryResult = await request('/api/advisories', { method: 'GET', headers: authHeaders })
  assert(advisoryResult.response.status === 200, 'advisories request failed', {
    status: advisoryResult.response.status,
    body: advisoryResult.body,
  })
  assert(Array.isArray(advisoryResult.body?.advisories), 'advisories response missing advisories array', {
    body: advisoryResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'advisories.list', status: 'ok' }))

  const zonesResult = await request('/api/zones', { method: 'GET', headers: authHeaders })
  assert(zonesResult.response.status === 200, 'zones request failed', {
    status: zonesResult.response.status,
    body: zonesResult.body,
  })
  assert(Array.isArray(zonesResult.body?.zones), 'zones response missing zones array', {
    body: zonesResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'zones.list', status: 'ok' }))

  const intelResult = await request('/api/intel', { method: 'GET', headers: authHeaders })
  assert(intelResult.response.status === 200, 'intel list request failed', {
    status: intelResult.response.status,
    body: intelResult.body,
  })
  assert(Array.isArray(intelResult.body?.intel), 'intel list response missing intel array', {
    body: intelResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'intel.list', status: 'ok' }))

  const profileResult = await request('/api/profile', { method: 'GET', headers: authHeaders })
  assert(profileResult.response.status === 200, 'profile request failed', {
    status: profileResult.response.status,
    body: profileResult.body,
  })
  assert(typeof profileResult.body?.profile?.call_sign === 'string', 'profile response missing call_sign', {
    body: profileResult.body,
  })
  console.log(JSON.stringify({ level: 'info', check: 'profile.read', status: 'ok' }))

  const adminOverviewResult = await request('/api/admin/overview', {
    method: 'GET',
    headers: authHeaders,
  })
  assert(adminOverviewResult.response.status === ADMIN_EXPECTED_STATUS, 'admin RBAC check failed', {
    expected: ADMIN_EXPECTED_STATUS,
    actual: adminOverviewResult.response.status,
    body: adminOverviewResult.body,
  })
  console.log(
    JSON.stringify({
      level: 'info',
      check: 'admin.overview',
      status: 'ok',
      expectedStatus: ADMIN_EXPECTED_STATUS,
    }),
  )

  const presignResult = await request('/api/uploads/presign', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fileName: 'cutover-proof.txt',
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
      message: 'cutover readiness verification completed',
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

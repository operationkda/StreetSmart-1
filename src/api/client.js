/// <reference types="vite/client" />

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

// Maximum number of retries for transient network (fetch) failures.
const MAX_RETRIES = 3
// Base delay in milliseconds for exponential backoff (doubles each attempt).
const RETRY_BASE_MS = 500

function getStoredToken() {
  try {
    return localStorage.getItem('authToken')
  } catch {
    return null
  }
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null)
    if (payload && typeof payload.error === 'string') {
      return payload.error
    }
  }

  return response.text().catch(() => '')
}

/**
 * Returns true for fetch-level failures (no network, DNS, connection refused)
 * that are safe to retry. HTTP error responses are authoritative and must not
 * be retried automatically.
 */
function isRetryable(error) {
  return error instanceof TypeError && error.message.toLowerCase().includes('fetch')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {})

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getStoredToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with full jitter so concurrent retries don't
      // create a thundering herd on a flaky mobile connection.
      const cap = RETRY_BASE_MS * 2 ** (attempt - 1)
      await sleep(Math.random() * cap)
    }

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      })

      if (!response.ok) {
        const message = await parseErrorResponse(response)
        throw new Error(message || `Request failed: ${response.status}`)
      }

      if (response.status === 204) {
        return null
      }

      return response.json()
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error
      }
      lastError = error
    }
  }

  // Unreachable, but keeps TypeScript/tooling happy.
  throw lastError
}

export const apiClient = {
  login(credentials) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })
  },
  getBriefing() {
    return request('/api/briefing')
  },
  listZones() {
    return request('/api/zones')
  },
  listAdvisories() {
    return request('/api/advisories')
  },
  listIntel() {
    return request('/api/intel')
  },
  createIntel(payload) {
    return request('/api/intel', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  deleteIntel(id) {
    return request(`/api/intel/${id}`, { method: 'DELETE' })
  },
  getProfile() {
    return request('/api/profile')
  },
  updateProfile(payload) {
    return request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
  getAdminOverview() {
    return request('/api/admin/overview')
  },
}

/// <reference types="vite/client" />

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

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

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {})

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getStoredToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

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
}

export const apiClient = {
  login(email) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },
  listTasks() {
    return request('/api/tasks')
  },
  createTask(title) {
    return request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  },
  updateTask(id, title) {
    return request(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    })
  },
  deleteTask(id) {
    return request(`/api/tasks/${id}`, { method: 'DELETE' })
  },
  listAdminTasks() {
    return request('/api/admin/tasks')
  },
}

/// <reference types="vite/client" />
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {})
  headers.set('Content-Type', 'application/json')

  const token = localStorage.getItem('authToken')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const message = await response.text()
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
}

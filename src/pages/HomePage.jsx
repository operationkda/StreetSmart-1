import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TaskPanel } from '@/components/TaskPanel.jsx'
import { apiClient } from '@/api/client.js'
import { useAppState } from '@/state/AppState.jsx'

function decodeTokenRole(token) {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role ?? null
  } catch {
    return null
  }
}

export function HomePage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const { authToken, setAuthToken } = useAppState()
  const role = decodeTokenRole(authToken)

  async function onLogin(event) {
    event.preventDefault()
    setError('')

    try {
      const response = await apiClient.login(email)
      setAuthToken(response.token)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '48px auto', padding: 16 }}>
      <h1>StreetSmart Independent App</h1>
      <p>Frontend is fully local and talks to your own backend via VITE_API_BASE_URL.</p>

      {!authToken ? (
        <form onSubmit={onLogin} style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #304163' }}
          />
          <button type="submit" style={{ padding: '8px 14px', borderRadius: 8 }}>
            Login
          </button>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button type="button" onClick={() => setAuthToken('')} style={{ padding: '8px 14px', borderRadius: 8 }}>
            Logout
          </button>
          {role === 'admin' ? (
            <Link to="/admin" style={{ fontSize: 14 }}>
              Admin dashboard →
            </Link>
          ) : null}
        </div>
      )}

      {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      {authToken ? <TaskPanel /> : null}
    </main>
  )
}

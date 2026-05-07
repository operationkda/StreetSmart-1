import { useState } from 'react'
import { TaskPanel } from '@/components/TaskPanel.jsx'
import { apiClient } from '@/api/client.js'
import { useAppState } from '@/state/AppState.jsx'

export function HomePage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const { authToken, setAuthToken } = useAppState()

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
        <button type="button" onClick={() => setAuthToken('')} style={{ marginBottom: 16 }}>
          Logout
        </button>
      )}

      {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      <TaskPanel />
    </main>
  )
}

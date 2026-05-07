import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/api/client.js'
import { StreetSmartDashboard } from '@/components/StreetSmartDashboard.jsx'
import { useAppState } from '@/state/AppState.jsx'
import { decodeTokenRole } from '@/lib/auth.js'

const shellStyle = {
  maxWidth: 1120,
  margin: '48px auto',
  padding: 16,
}

const cardStyle = {
  border: '1px solid #243252',
  borderRadius: 18,
  padding: 20,
  background: 'rgba(14, 22, 38, 0.88)',
}

export function HomePage() {
  const [authMode, setAuthMode] = useState('dev')
  const [email, setEmail] = useState('')
  const [providerToken, setProviderToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { authToken, setAuthToken } = useAppState()
  const role = decodeTokenRole(authToken)

  async function onLogin(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const response = await apiClient.login(
        authMode === 'dev' ? { email } : { providerToken },
      )
      setAuthToken(response.token)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={shellStyle}>
      <section style={{ ...cardStyle, marginBottom: 20, background: 'linear-gradient(135deg, rgba(22, 40, 76, 0.95), rgba(13, 22, 40, 0.95))' }}>
        <p style={{ marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#93c5fd', fontSize: 12 }}>
          StreetSmart · independent ops console
        </p>
        <h1 style={{ marginTop: 0 }}>Field awareness, advisories, and security posture in one dashboard.</h1>
        <p style={{ maxWidth: 780, marginBottom: 0 }}>
          This slice replaces the task demo with a real StreetSmart operational baseline: threat briefing, tactical zones, advisories,
          intel logging, emergency contacts, and security controls backed by the independent API.
        </p>
      </section>

      {!authToken ? (
        <section style={cardStyle}>
          <h2>Sign in</h2>
          <p style={{ color: '#94a3b8' }}>Use dev email mode locally or paste an OIDC provider token for production-like validation.</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              ['dev', 'Dev email'],
              ['oidc', 'OIDC token'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAuthMode(mode)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: authMode === mode ? '#1d4ed8' : 'transparent',
                  color: '#e5ecff',
                  border: '1px solid #304163',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={onLogin} style={{ display: 'grid', gap: 12 }}>
            {authMode === 'dev' ? (
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@example.com"
                style={{ padding: 12, borderRadius: 12, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
              />
            ) : (
              <textarea
                value={providerToken}
                onChange={(event) => setProviderToken(event.target.value)}
                placeholder="Paste provider JWT"
                rows={6}
                style={{ padding: 12, borderRadius: 12, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
              />
            )}
            <button type="submit" disabled={busy} style={{ padding: '12px 16px', borderRadius: 12 }}>
              {busy ? 'Signing in…' : 'Access dashboard'}
            </button>
          </form>
          {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
        </section>
      ) : (
        <>
          <section style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 12 }}>Session active</p>
              <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>
                Role: <strong style={{ color: '#e5ecff' }}>{role ?? 'user'}</strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {role === 'admin' ? (
                <Link to="/admin" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #304163', textDecoration: 'none' }}>
                  Admin overview
                </Link>
              ) : null}
              <button type="button" onClick={() => setAuthToken('')} style={{ padding: '10px 14px', borderRadius: 10 }}>
                Logout
              </button>
            </div>
          </section>
          <StreetSmartDashboard />
        </>
      )}
    </main>
  )
}

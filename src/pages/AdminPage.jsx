import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/api/client.js'
import { useAppState } from '@/state/AppState.jsx'
import { decodeTokenRole } from '@/lib/auth.js'

const cardStyle = {
  border: '1px solid #243252',
  borderRadius: 16,
  padding: 16,
  background: 'rgba(14, 22, 38, 0.88)',
}

export function AdminPage() {
  const { authToken } = useAppState()
  const navigate = useNavigate()
  const role = decodeTokenRole(authToken)
  const [overview, setOverview] = useState(null)
  const [recentIntel, setRecentIntel] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authToken || role !== 'admin') {
      navigate('/', { replace: true })
      return
    }

    apiClient
      .getAdminOverview()
      .then((response) => {
        setOverview(response.overview)
        setRecentIntel(response.recentIntel ?? [])
        setLoading(false)
      })
      .catch((requestError) => {
        setError(requestError.message)
        setLoading(false)
      })
  }, [authToken, role, navigate])

  return (
    <main style={{ maxWidth: 960, margin: '48px auto', padding: 16 }}>
      <h1>Admin operations overview</h1>
      {loading ? <p>Loading…</p> : null}
      {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      {overview ? (
        <section style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 24 }}>
          <article style={cardStyle}>
            <strong>{overview.totalIntelReports}</strong>
            <p style={{ color: '#94a3b8', marginBottom: 0 }}>Total intel reports</p>
          </article>
          <article style={cardStyle}>
            <strong>{overview.urgentIntelReports}</strong>
            <p style={{ color: '#94a3b8', marginBottom: 0 }}>Urgent reports</p>
          </article>
          <article style={cardStyle}>
            <strong>{overview.activeAdvisories}</strong>
            <p style={{ color: '#94a3b8', marginBottom: 0 }}>Active advisories</p>
          </article>
          <article style={cardStyle}>
            <strong>{overview.dangerZones}</strong>
            <p style={{ color: '#94a3b8', marginBottom: 0 }}>Danger zones</p>
          </article>
        </section>
      ) : null}
      {overview ? (
        <p style={{ ...cardStyle, marginBottom: 24 }}>{overview.recommendedAction}</p>
      ) : null}

      <section>
        <h2>Recent field reports</h2>
        {!recentIntel.length ? <p>No intel reports captured yet.</p> : null}
        {recentIntel.length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {recentIntel.map((entry) => (
              <article key={entry.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>{entry.title}</strong>
                  <span style={{ textTransform: 'uppercase', fontSize: 12, color: '#fca5a5' }}>{entry.priority}</span>
                </div>
                <p style={{ color: '#94a3b8', marginBottom: 8 }}>
                  {entry.owner} · {entry.location} · {new Date(entry.created_at).toLocaleString()}
                </p>
                <p style={{ marginBottom: 0 }}>{entry.details}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  )
}

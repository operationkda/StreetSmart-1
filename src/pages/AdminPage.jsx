import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export function AdminPage() {
  const { authToken } = useAppState()
  const navigate = useNavigate()
  const role = decodeTokenRole(authToken)

  const [tasks, setTasks] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Redirect unauthenticated or non-admin users before making any API call.
    // The backend also enforces RBAC and will return 403 for non-admins.
    if (!authToken || role !== 'admin') {
      navigate('/', { replace: true })
      return
    }

    apiClient
      .listAdminTasks()
      .then((response) => {
        setTasks(response.tasks ?? [])
        setLoading(false)
      })
      .catch((requestError) => {
        setError(requestError.message)
        setLoading(false)
      })
  }, [authToken, role, navigate])

  return (
    <main style={{ maxWidth: 760, margin: '48px auto', padding: 16 }}>
      <h1>Admin — All Tasks</h1>
      {loading ? <p>Loading…</p> : null}
      {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      {!loading && !error && tasks.length === 0 ? <p>No tasks found.</p> : null}
      {tasks.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #304163' }}>
              <th style={{ padding: '6px 8px' }}>Title</th>
              <th style={{ padding: '6px 8px' }}>Owner</th>
              <th style={{ padding: '6px 8px' }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} style={{ borderBottom: '1px solid #1e2d4a' }}>
                <td style={{ padding: '6px 8px' }}>{task.title}</td>
                <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{task.owner}</td>
                <td style={{ padding: '6px 8px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {new Date(task.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  )
}

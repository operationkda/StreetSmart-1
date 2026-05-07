import { useEffect, useState } from 'react'
import { apiClient } from '@/api/client.js'

export function TaskPanel() {
  const [tasks, setTasks] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient
      .listTasks()
      .then((response) => setTasks(response.tasks ?? []))
      .catch((requestError) => setError(requestError.message))
  }, [])

  async function onCreateTask(event) {
    event.preventDefault()
    setError('')

    if (!title.trim()) {
      return
    }

    try {
      const response = await apiClient.createTask(title.trim())
      setTasks((current) => [response.task, ...current])
      setTitle('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <section style={{ border: '1px solid #243252', borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Tasks (Backend CRUD)</h2>
      <form onSubmit={onCreateTask} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Task title"
          style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #304163' }}
        />
        <button type="submit" style={{ padding: '8px 14px', borderRadius: 8 }}>
          Add
        </button>
      </form>
      {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </section>
  )
}

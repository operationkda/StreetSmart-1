import { useEffect, useState } from 'react'
import { apiClient } from '@/api/client.js'

function TaskRow({ task, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState('')

  async function onSave(event) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || trimmed === task.title) {
      setEditing(false)
      setDraft(task.title)
      return
    }
    setBusy(true)
    setRowError('')
    try {
      const response = await apiClient.updateTask(task.id, trimmed)
      onUpdated(response.task)
      setEditing(false)
    } catch (err) {
      setRowError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function onCancel() {
    setEditing(false)
    setDraft(task.title)
    setRowError('')
  }

  async function onDelete() {
    setBusy(true)
    setRowError('')
    try {
      await apiClient.deleteTask(task.id)
      onDeleted(task.id)
    } catch (err) {
      setRowError(err.message)
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <li style={{ marginBottom: 6 }}>
        <form onSubmit={onSave} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid #304163' }}
            disabled={busy}
          />
          <button type="submit" disabled={busy} style={{ padding: '4px 10px', borderRadius: 6 }}>
            Save
          </button>
          <button type="button" onClick={onCancel} disabled={busy} style={{ padding: '4px 10px', borderRadius: 6 }}>
            Cancel
          </button>
        </form>
        {rowError ? <p style={{ color: '#fca5a5', margin: '2px 0 0' }}>{rowError}</p> : null}
      </li>
    )
  }

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ flex: 1 }}>{task.title}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12 }}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, color: '#fca5a5' }}
      >
        Delete
      </button>
      {rowError ? <span style={{ color: '#fca5a5', fontSize: 12 }}>{rowError}</span> : null}
    </li>
  )
}

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

  function onUpdated(updatedTask) {
    setTasks((current) => current.map((t) => (t.id === updatedTask.id ? updatedTask : t)))
  }

  function onDeleted(deletedId) {
    setTasks((current) => current.filter((t) => t.id !== deletedId))
  }

  return (
    <section style={{ border: '1px solid #243252', borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Tasks</h2>
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
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onUpdated={onUpdated} onDeleted={onDeleted} />
        ))}
      </ul>
    </section>
  )
}

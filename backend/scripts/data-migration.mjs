import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { migrate, query, closePool } from '../src/db.mjs'

const mode = process.argv[2]
const targetFile = process.argv[3] ?? './tmp/tasks-export.json'
const absoluteFile = resolve(process.cwd(), targetFile)

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for data migration scripts')
}

if (!['export', 'import'].includes(mode)) {
  throw new Error('Usage: node scripts/data-migration.mjs <export|import> [file]')
}

async function exportData() {
  await migrate()
  const tasks = (await query('SELECT id, title, owner, created_at FROM tasks ORDER BY created_at ASC')).rows
  await mkdir(dirname(absoluteFile), { recursive: true })
  await writeFile(
    absoluteFile,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), tasks }, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify({ level: 'info', message: 'tasks export complete', file: absoluteFile, count: tasks.length }))
}

async function importData() {
  await migrate()
  const raw = await readFile(absoluteFile, 'utf8')
  const payload = JSON.parse(raw)
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : []

  for (const [index, task] of tasks.entries()) {
    if (!task?.id || !task?.title || !task?.owner || !task?.created_at) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'skipping invalid task record during import',
          index,
        }),
      )
      continue
    }
    await query(
      `
      INSERT INTO tasks (id, title, owner, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      -- Preserve original created_at for existing rows; only sync mutable fields.
      SET title = EXCLUDED.title,
          owner = EXCLUDED.owner
      `,
      [task.id, task.title, task.owner, task.created_at],
    )
  }

  console.log(JSON.stringify({ level: 'info', message: 'tasks import complete', file: absoluteFile, count: tasks.length }))
}

try {
  if (mode === 'export') {
    await exportData()
  } else {
    await importData()
  }
} finally {
  await closePool()
}

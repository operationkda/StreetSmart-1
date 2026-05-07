import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { migrate, query, closePool } from '../src/db.mjs'

const mode = process.argv[2]
const targetFile = process.argv[3] ?? './tmp/intel-export.json'
const absoluteFile = resolve(process.cwd(), targetFile)

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for data migration scripts')
}

if (!['export', 'import'].includes(mode)) {
  throw new Error('Usage: node scripts/data-migration.mjs <export|import> [file]')
}

async function exportData() {
  await migrate()
  const intel = (
    await query(
      'SELECT id, title, details, priority, location, owner, created_at FROM intel_entries ORDER BY created_at ASC',
    )
  ).rows
  await mkdir(dirname(absoluteFile), { recursive: true })
  await writeFile(
    absoluteFile,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), intel }, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify({ level: 'info', message: 'intel export complete', file: absoluteFile, count: intel.length }))
}

async function importData() {
  await migrate()
  const raw = await readFile(absoluteFile, 'utf8')
  const payload = JSON.parse(raw)
  const intel = Array.isArray(payload?.intel) ? payload.intel : []

  for (const [index, entry] of intel.entries()) {
    if (!entry?.id || !entry?.title || !entry?.details || !entry?.priority || !entry?.location || !entry?.owner || !entry?.created_at) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'skipping invalid intel record during import',
          index,
        }),
      )
      continue
    }
    await query(
      `
      INSERT INTO intel_entries (id, title, details, priority, location, owner, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title,
          details = EXCLUDED.details,
          priority = EXCLUDED.priority,
          location = EXCLUDED.location,
          owner = EXCLUDED.owner
      `,
      [entry.id, entry.title, entry.details, entry.priority, entry.location, entry.owner, entry.created_at],
    )
  }

  console.log(JSON.stringify({ level: 'info', message: 'intel import complete', file: absoluteFile, count: intel.length }))
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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const sourceFile = process.argv[2] ?? './tmp/base44-export.json'
const targetFile = process.argv[3] ?? './tmp/tasks-import.json'
const sourcePath = resolve(process.cwd(), sourceFile)
const targetPath = resolve(process.cwd(), targetFile)
// Sentinel owner used when source records do not contain user identity fields.
const UNKNOWN_OWNER_EMAIL = 'unknown@example.com'
// Deterministic sentinel for missing/invalid source timestamps during migration.
const FALLBACK_CREATED_AT = '1970-01-01T00:00:00.000Z'

function asArray(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.tasks)) return payload.tasks
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function getRawId(raw) {
  const candidate = raw?.id ?? raw?._id ?? raw?.taskId ?? raw?.task_id
  if (typeof candidate !== 'string') return ''
  return candidate.trim()
}

function normalizeOwner(raw) {
  const candidate =
    raw?.owner ??
    raw?.email ??
    raw?.userEmail ??
    raw?.createdBy ??
    raw?.created_by ??
    raw?.user ??
    raw?.userId ??
    UNKNOWN_OWNER_EMAIL
  return String(candidate).trim().toLowerCase() || UNKNOWN_OWNER_EMAIL
}

function normalizeTitle(raw) {
  const candidate = raw?.title ?? raw?.name ?? raw?.taskTitle ?? raw?.task_title ?? 'Untitled task'
  const title = String(candidate).trim()
  return title || 'Untitled task'
}

function normalizeCreatedAt(raw) {
  const candidate =
    raw?.created_at ??
    raw?.createdAt ??
    raw?.created ??
    raw?.timestamp ??
    raw?.insertedAt ??
    raw?.inserted_at
  const date = new Date(String(candidate ?? ''))
  if (Number.isNaN(date.getTime())) return FALLBACK_CREATED_AT
  return date.toISOString()
}

function normalizeTask(raw, index) {
  const rawId = getRawId(raw)
  const id = rawId || randomUUID()
  return {
    id,
    title: normalizeTitle(raw),
    owner: normalizeOwner(raw),
    created_at: normalizeCreatedAt(raw),
    _sourceIndex: index,
  }
}

async function main() {
  const rawInput = await readFile(sourcePath, 'utf8')
  const parsed = JSON.parse(rawInput)
  const sourceRecords = asArray(parsed)

  if (!sourceRecords.length) {
    throw new Error('No records found in source payload. Expected array or object with tasks/items/data/records')
  }

  const dedupedById = new Map()
  let generatedIds = 0
  let fallbackTimestampCount = 0
  for (const [index, record] of sourceRecords.entries()) {
    const normalized = normalizeTask(record, index)
    if (!getRawId(record)) generatedIds += 1
    if (normalized.created_at === FALLBACK_CREATED_AT) fallbackTimestampCount += 1
    if (dedupedById.has(normalized.id)) continue
    dedupedById.set(normalized.id, normalized)
  }

  const tasks = [...dedupedById.values()]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(({ _sourceIndex, ...task }) => task)

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(
    targetPath,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        tasks,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'base44 transform complete',
      sourcePath,
      targetPath,
      sourceCount: sourceRecords.length,
      taskCount: tasks.length,
      generatedIds,
      fallbackTimestampCount,
      droppedDuplicates: sourceRecords.length - tasks.length,
    }),
  )
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exit(1)
})

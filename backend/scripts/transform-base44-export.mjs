import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const sourceFile = process.argv[2] ?? './tmp/base44-export.json'
const targetFile = process.argv[3] ?? './tmp/tasks-import.json'
const sourcePath = resolve(process.cwd(), sourceFile)
const targetPath = resolve(process.cwd(), targetFile)

function asArray(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.tasks)) return payload.tasks
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.items)) return payload.items
  return []
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
    'unknown@example.com'
  return String(candidate).trim().toLowerCase() || 'unknown@example.com'
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
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function normalizeTask(raw, index) {
  const idCandidate = raw?.id ?? raw?._id ?? raw?.taskId ?? raw?.task_id
  const id = typeof idCandidate === 'string' && idCandidate.trim() ? idCandidate.trim() : randomUUID()
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
  for (const [index, record] of sourceRecords.entries()) {
    const normalized = normalizeTask(record, index)
    if (!record?.id && !record?._id && !record?.taskId && !record?.task_id) generatedIds += 1
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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const sourceFile = process.argv[2] ?? './tmp/base44-export.json'
const targetFile = process.argv[3] ?? './tmp/intel-import.json'
const sourcePath = resolve(process.cwd(), sourceFile)
const targetPath = resolve(process.cwd(), targetFile)
const UNKNOWN_OWNER_EMAIL = 'unknown@example.com'
const FALLBACK_CREATED_AT = '1970-01-01T00:00:00.000Z'

function asArray(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.intel)) return payload.intel
  if (Array.isArray(payload?.tasks)) return payload.tasks
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function getRawId(raw) {
  const candidate = raw?.id ?? raw?._id ?? raw?.intelId ?? raw?.intel_id ?? raw?.taskId ?? raw?.task_id
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
  const candidate = raw?.title ?? raw?.name ?? raw?.headline ?? raw?.subject ?? raw?.taskTitle ?? raw?.task_title ?? 'Untitled intel report'
  const title = String(candidate).trim()
  return title || 'Untitled intel report'
}

function normalizeDetails(raw) {
  const candidate = raw?.details ?? raw?.description ?? raw?.summary ?? raw?.note ?? raw?.body ?? 'No details provided.'
  const details = String(candidate).trim()
  return details || 'No details provided.'
}

function normalizeLocation(raw) {
  const candidate = raw?.location ?? raw?.zone ?? raw?.region ?? raw?.city ?? 'Unknown sector'
  const location = String(candidate).trim()
  return location || 'Unknown sector'
}

function normalizePriority(raw) {
  const candidate = String(raw?.priority ?? raw?.severity ?? raw?.risk ?? '').trim().toLowerCase()
  return ['low', 'moderate', 'high', 'critical'].includes(candidate) ? candidate : 'moderate'
}

function normalizeCreatedAt(raw) {
  const candidate = raw?.created_at ?? raw?.createdAt ?? raw?.created ?? raw?.timestamp ?? raw?.insertedAt ?? raw?.inserted_at
  const date = new Date(String(candidate ?? ''))
  if (Number.isNaN(date.getTime())) return FALLBACK_CREATED_AT
  return date.toISOString()
}

function normalizeIntel(raw, index) {
  const rawId = getRawId(raw)
  const id = rawId || randomUUID()
  return {
    id,
    title: normalizeTitle(raw),
    details: normalizeDetails(raw),
    priority: normalizePriority(raw),
    location: normalizeLocation(raw),
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
    throw new Error('No records found in source payload. Expected array or object with intel/tasks/items/data/records')
  }

  const dedupedById = new Map()
  let generatedIds = 0
  let fallbackTimestampCount = 0
  for (const [index, record] of sourceRecords.entries()) {
    const normalized = normalizeIntel(record, index)
    if (!getRawId(record)) generatedIds += 1
    if (normalized.created_at === FALLBACK_CREATED_AT) fallbackTimestampCount += 1
    if (dedupedById.has(normalized.id)) continue
    dedupedById.set(normalized.id, normalized)
  }

  const intel = [...dedupedById.values()]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(({ _sourceIndex, ...entry }) => entry)

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(
    targetPath,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), intel }, null, 2)}\n`,
    'utf8',
  )

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'base44 transform complete',
      sourcePath,
      targetPath,
      sourceCount: sourceRecords.length,
      intelCount: intel.length,
      generatedIds,
      fallbackTimestampCount,
      droppedDuplicates: sourceRecords.length - intel.length,
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

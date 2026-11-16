export type Stage = "draft" | "editing" | "review" | "accepted"
export type AgentId = "claude" | "codex" | "none"

export type Job = {
  id: number
  kind: "edit" | "final"
  status: "queued" | "running" | "done" | "failed" | "cancelled"
  step: string | null
  progress: number | null
  error: string | null
}

/** What the editing agent spent. costUsd is at API list prices (Claude Code); Codex reports no cost. */
export type Usage = {
  runs: number
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  thinkingTokens: number
  tokens: number
  costUsd: number | null
  unpricedRuns: number
}
export type UsageSummary = {
  total: Usage
  byModel: (Usage & { agent: string; model: string | null })[]
  byMonth: (Usage & { month: string })[]
  videos: (Usage & { id: number; title: string; stage: Stage; latestVersion: number | null; lastRunAt: string | null })[]
}

export type Video = {
  id: number
  title: string
  brief: string
  stage: Stage
  latest_version: number | null
  accepted_version: number | null
  created_at: string
  updated_at: string
  job: Job | null
  usage: Usage
}

export type Message = {
  id: number
  version: number | null
  role: "user" | "agent" | "system"
  body: string
  created_at: string
  ref_version: number | null
  at_seconds: number | null
  source_seconds: number | null
  context: string | null
}

export type Version = {
  number: number
  name: string
  createdAt: string
  durationSeconds: number | null
  removedSeconds: number | null
  agent: AgentId | null
  model: string | null
  buildSeconds: number | null
  files: string[]
  usage: Usage | null
}

export type MediaFile = { name: string; kind: "audio" | "image" | "video"; size: number; duration: number | null; width: number | null; height: number | null; hasAudio: boolean }
export type Library = { categories: { id: "music" | "sfx" | "other"; label: string; files: MediaFile[] }[]; defaultMusic: string | null }
export type VideoDetail = Video & { sources: string[]; assets: MediaFile[]; versions: Version[]; messages: Message[] }

export type Segment = { programStart: number; programEnd: number; sourceStart: number; sourceEnd: number }
export type Word = { start: number; end: number; text: string; source: number }
export type PlacedOverlay = { id: string; type: string; component?: string; start: number; end: number; label: string }
export type Timeline = { version: number; duration: number; segments: Segment[]; words: Word[]; overlays: PlacedOverlay[]; waveform: string | null }

export type AppState = {
  onboarded: boolean
  agent: AgentId
  agentLabels: Record<AgentId, string>
  agentStatus: { claude: boolean; codex: boolean }
  agentModels: Record<"claude" | "codex", { model: string; effort: string }>
  efforts: Record<"claude" | "codex", string[]>
  pack: string
  defaults: { language?: string }
  whisperModel: string
  defaultMusic: string | null
  jobConcurrency: number
  sound: Sound
  soundDefaults: Sound
  soundLimits: Record<keyof Sound, [number, number]>
  maxConcurrency: number
  machine: { cpus: number; memoryGb: number; suggested: number }
  authRequired: boolean
}

export type Sound = { targetLufs: number; sfxDb: number; musicDb: number; musicPauseDb: number }

export type NotifyEvent = "review" | "failed" | "final"
export type Telegram = {
  configured: boolean
  bot: string | null
  connected: boolean
  chatName: string | null
  link: string | null
  events: Record<NotifyEvent, boolean>
  eventLabels: Record<NotifyEvent, string>
  publicUrl: string | null
  lastError: { at: string; message: string } | null
  lastSentAt: string | null
}

export type Pack = {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  license?: string
  builtin: boolean
  components?: string[]
  replaces?: Record<string, string>
  error?: string
}
export type Packs = { active: string | null; packs: Pack[] }

export type Taste = { profile: string; answers: Record<string, string>; refs: string[] }

export type DictionaryEntry = {
  id: number
  from: string | null
  to: string
  videoId: number | null
  videoTitle: string | null
  status: "active" | "proposed" | "rejected"
  source: "author" | "agent"
  note: string | null
  version: number | null
  createdAt: string
}
export type WhisperModel = { id: string; label: string; size: string; note: string; downloaded: boolean }
export type Dictionary = { entries: DictionaryEntry[]; model: string; models: WhisperModel[] }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...init } = options
  const res = await fetch(path, {
    ...init,
    headers: json !== undefined ? { "content-type": "application/json", ...init.headers } : init.headers,
    body: json !== undefined ? JSON.stringify(json) : init.body,
  })
  const type = res.headers.get("content-type") ?? ""
  const data = type.includes("json") ? await res.json() : await res.text()
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login") && location.hash !== "#/login") location.hash = "#/login"
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Ошибка ${res.status}`)
  }
  return data as T
}

export const post = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json })
export const put = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: "PUT", json })
export const patch = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: "PATCH", json })

/** Raw PUT of a file with upload progress (fetch has no upload progress). */
export function upload<T = unknown>(url: string, file: File, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const body = xhr.responseText ? JSON.parse(xhr.responseText) : {}
      if (xhr.status < 300) resolve(body as T)
      else reject(new ApiError(xhr.status, body.error ?? `Ошибка ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error("Сеть недоступна"))
    xhr.send(file)
  })
}

export const STAGES: [Stage, string][] = [
  ["draft", "Черновик"],
  ["editing", "В монтаже"],
  ["review", "На проверке"],
  ["accepted", "Принято"],
]
export const STAGE_LABEL = Object.fromEntries(STAGES) as Record<Stage, string>

export const vname = (n: number) => `v${String(n).padStart(3, "0")}`
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/** 75.4 → "1:15.4"; with `tenths: false` → "1:15". */
export function fmtTime(seconds: number | null | undefined, tenths = false) {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const whole = Math.floor(s)
  const tail = tenths ? `.${Math.floor((s - whole) * 10)}` : ""
  return `${m}:${String(whole).padStart(2, "0")}${tail}`
}

export const isActive = (job: Job | null | undefined): job is Job & { status: "queued" | "running" } => !!job && (job.status === "queued" || job.status === "running")

/** 1.3067 → "$1,31"; null → "—". */
export const fmtUsd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** 1485920 → "1,5 млн", 84000 → "84 тыс." */
export function fmtTokens(value: number) {
  if (value >= 1e6) return `${(value / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`
  if (value >= 1e3) return `${Math.round(value / 1e3)} тыс.`
  return String(value)
}
/** "$1,31 · 1,5 млн токенов" or tokens only when no cost was reported. */
export const fmtUsage = (u: Usage) => [u.costUsd != null ? fmtUsd(u.costUsd) : null, `${fmtTokens(u.tokens)} токенов`].filter(Boolean).join(" · ")

// Word-by-word captions. Words are grouped into short pages; the spoken word
// gets an accent pill ("pill") or the accent colour ("plain").
import { useMemo } from "react"
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { clamp } from "../motion"
import type { Box, CaptionsSettings, Theme, Word } from "../types"

type Page = { words: Word[]; start: number; end: number }

function paginate(words: Word[], perPage: number): Page[] {
  const pages: Page[] = []
  let current: Word[] = []
  const flush = () => {
    if (current.length) pages.push({ words: current, start: current[0].start, end: current[current.length - 1].end })
    current = []
  }
  for (const word of words) {
    const previous = current[current.length - 1]
    const pause = previous ? word.start - previous.end : 0
    const sentenceEnd = previous && /[.!?…]$/.test(previous.text)
    if (current.length >= perPage || pause > 0.6 || sentenceEnd) flush()
    current.push(word)
  }
  flush()
  return pages
}

/** What a captions component receives; a taste pack may replace the component ("replaces.captions"). */
export type CaptionsProps = {
  words: Word[]
  settings: CaptionsSettings
  theme: Theme
  u: number
  width: number
  height: number
  hidden: boolean
  /** Area reserved for captions by the core layout; draw centred in it. */
  box: Box
  /** What is behind the captions now: the camera image or a full-frame graphic. */
  backdrop: "video" | "graphic"
}

export { paginate }

export function Captions({ words, settings, theme, u, hidden, box }: CaptionsProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const pages = useMemo(() => paginate(words, Math.max(1, settings.wordsPerPage)), [words, settings.wordsPerPage])
  if (hidden) return null
  const index = pages.findIndex((page, i) => t >= page.start - 0.05 && t < Math.min(page.end + 0.5, pages[i + 1]?.start ?? Infinity))
  if (index < 0) return null
  const page = pages[index]
  const appear = interpolate(t, [page.start - 0.05, page.start + 0.08], [0, 1], clamp)
  const pill = settings.style === "pill"
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        width: box.w,
        top: box.y + box.h / 2,
        transform: `translateY(-50%) scale(${0.96 + 0.04 * appear})`,
        opacity: appear,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        // Plain words carry a thick stroke: leave a real word space between them.
        gap: pill ? `${6 * u}px ${10 * u}px` : `${4 * u}px ${24 * u}px`,
        fontFamily: theme.captionFont,
        fontSize: 64 * u,
        fontWeight: 800,
        lineHeight: 1.15,
        letterSpacing: "-0.01em",
        textTransform: settings.uppercase ? "uppercase" : "none",
      }}
    >
      {page.words.map((word, i) => {
        const active = t >= word.start && (t < (page.words[i + 1]?.start ?? page.end + 0.5))
        const pop = interpolate(t, [word.start, word.start + 0.08], [0, 1], clamp)
        return (
          <span
            key={`${word.start}-${i}`}
            style={{
              padding: pill ? `${4 * u}px ${16 * u}px` : 0,
              borderRadius: 999,
              background: pill && active ? theme.accent : "transparent",
              color: active ? (pill ? theme.accentForeground : theme.accent) : "#ffffff",
              transform: active ? `scale(${1 + 0.06 * pop})` : "none",
              WebkitTextStroke: active && pill ? "0px" : `${8 * u}px rgba(0,0,0,0.85)`,
              paintOrder: "stroke fill",
              textShadow: active && pill ? "none" : `0 ${4 * u}px ${18 * u}px rgba(0,0,0,0.45)`,
            }}
          >
            {word.text.replace(/[.,!?…:;]+$/, "")}
          </span>
        )
      })}
    </div>
  )
}

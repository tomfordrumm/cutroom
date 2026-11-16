// "Who does what to what, and what changes": the scene map drawn directly.
//
// props:
//   subject  { label, icon } or a string — who acts
//   action   string — the verb, 1–3 words, on the arrow
//   object   { label, icon } or a string — what it acts on (optional)
//   result   { label, icon, tone: success|error|neutral } — the state after (optional)
//   at       0..1 — when the result appears, share of the overlay (default 0.55)
//   layout   row (default) | column
//   fullFrame true — on the theme background instead of a card over the video
//   position zone when not full frame (default auto)
//
// Labels are names of things (ChatGPT, «Настройки»), not sentences: the voice
// and captions carry the sentence.
// The icons below are JSX built when the module loads, so React must be in scope here.
import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { useLayout, useZoneStyle } from "../layout"
import { clamp, useEnterExit } from "../motion"
import type { OverlayProps, Theme } from "../types"

type Node = { label: string; icon: string | null }
const TONES = { success: "#16a34a", error: "#dc2626" } as const

function node(value: unknown): Node | null {
  if (typeof value === "string" && value.trim()) return { label: value.trim(), icon: null }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    const label = typeof v.label === "string" ? v.label.trim() : ""
    const icon = typeof v.icon === "string" ? v.icon : null
    if (label || icon) return { label, icon }
  }
  return null
}

// Simple line icons on a 24 px grid, drawn in the current color.
const ICONS: Record<string, React.ReactNode> = {
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9" r="2.8" /><path d="M2.5 20c0-3.8 2.9-6 6.5-6s6.5 2.2 6.5 6M15.5 14.2c3.2-.4 6 1.6 6 5.3" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 13.5h.01M15 13.5h.01M9.5 17h5" /><circle cx="12" cy="3.5" r="1" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></>,
  document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></>,
  idea: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" /></>,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  data: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.6-.9-1.7-1.5-3-1.5-1.9 0-3 1-3 2.4 0 3.2 6 1.8 6 5 0 1.4-1.3 2.6-3 2.6-1.4 0-2.6-.6-3.2-1.6M12 5v2M12 17v2" /></>,
  time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  warning: <><path d="M12 3 2 20h20z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  star: <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.4 6.4 20.4l1.1-6.3L3 9.7l6.2-.9z" />,
}

function Icon({ name, size, color }: { name: string | null; size: number; color: string }) {
  const shape = name ? ICONS[name] : null
  if (!shape) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {shape}
    </svg>
  )
}

/** A circle with an icon (or the label's first letter) and the label under it. */
function Badge({ item, theme, u, t, ring, fill }: { item: Node; theme: Theme; u: number; t: number; ring?: string; fill: string }) {
  const size = 190 * u
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u, opacity: t, transform: `scale(${0.6 + 0.4 * t})`, minWidth: size }}>
      <div style={{ width: size, height: size, borderRadius: 999, background: fill, display: "grid", placeItems: "center", boxShadow: ring ? `0 0 0 ${8 * u}px ${ring}` : `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.18)` }}>
        {ICONS[item.icon ?? ""] ? <Icon name={item.icon} size={size * 0.5} color={ring ?? theme.accent} />
          : <span style={{ fontFamily: theme.displayFont, fontWeight: 800, fontSize: size * 0.42, color: ring ?? theme.accent }}>{item.label.slice(0, 1).toUpperCase()}</span>}
      </div>
      {item.label && <div style={{ maxWidth: 300 * u, textAlign: "center", fontFamily: theme.displayFont, fontWeight: 800, fontSize: 42 * u, lineHeight: 1.1, textWrap: "balance" }}>{item.label}</div>}
    </div>
  )
}

export function Action({ props, theme, u: unit }: OverlayProps) {
  // A card over the video stays compact, so it fits between the face and the captions.
  const u = props.fullFrame === true ? unit : unit * 0.68
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const { safe } = useLayout()
  const zone = useZoneStyle(props.position)
  const { opacity } = useEnterExit()
  const subject = node(props.subject)
  const object = node(props.object)
  const resultRaw = props.result && typeof props.result === "object" ? (props.result as Record<string, unknown>) : null
  const result = node(props.result)
  const tone = resultRaw?.tone === "success" || resultRaw?.tone === "error" ? TONES[resultRaw.tone] : theme.accent
  const verb = typeof props.action === "string" ? props.action.trim() : ""
  const column = props.layout === "column"
  const full = props.fullFrame === true

  // Beats: subject, object, the arrow travels with the verb, then the result lands on the object.
  const pop = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 170, mass: 0.7 } })
  const tSubject = pop(0)
  const tObject = pop(Math.round(fps * 0.3))
  const arrowStart = Math.round(fps * 0.55)
  const tArrow = interpolate(frame, [arrowStart, arrowStart + fps * 0.5], [0, 1], clamp)
  const at = typeof props.at === "number" && props.at > 0 && props.at < 1 ? props.at : 0.55
  const resultFrame = Math.max(arrowStart + fps * 0.5, Math.round(durationInFrames * at))
  const tResult = result ? pop(resultFrame) : 0

  const arrowLength = (column ? 120 : 220) * u
  const arrow = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * u, opacity: Math.min(1, tArrow * 2) }}>
      {verb && <div style={{ padding: `${10 * u}px ${22 * u}px`, borderRadius: 999, background: theme.accent, color: theme.accentForeground, fontWeight: 800, fontSize: 36 * u, whiteSpace: "nowrap", transform: `translateY(${(1 - tArrow) * 10 * u}px)` }}>{verb}</div>}
      <svg width={column ? 40 * u : arrowLength} height={column ? arrowLength : 40 * u} viewBox={column ? `0 0 40 ${arrowLength / u}` : `0 0 ${arrowLength / u} 40`} style={{ overflow: "visible" }}>
        {column
          ? <path d={`M20 0 V${(arrowLength / u) * tArrow} M8 ${(arrowLength / u) * tArrow - 14} L20 ${(arrowLength / u) * tArrow} L32 ${(arrowLength / u) * tArrow - 14}`} stroke={theme.accent} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          : <path d={`M0 20 H${(arrowLength / u) * tArrow} M${(arrowLength / u) * tArrow - 14} 8 L${(arrowLength / u) * tArrow} 20 L${(arrowLength / u) * tArrow - 14} 32`} stroke={theme.accent} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  )

  const target = object ?? result
  const resultMark = result && (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * u, marginTop: 26 * u, opacity: tResult, transform: `scale(${0.5 + 0.5 * tResult}) rotate(${(1 - tResult) * -8}deg)` }}>
      {result.icon && <Icon name={result.icon} size={56 * u} color={tone} />}
      {result.label && <span style={{ padding: `${10 * u}px ${24 * u}px`, borderRadius: theme.radius * 0.6 * u, border: `${5 * u}px solid ${tone}`, color: tone, fontWeight: 900, fontSize: 40 * u, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{result.label}</span>}
    </div>
  )

  // Circles stand out from what is behind them: the card on the background, the background on a card.
  const fill = full ? theme.card : theme.background
  const content = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: full ? theme.foreground : theme.cardForeground }}>
      <div style={{ display: "flex", flexDirection: column ? "column" : "row", alignItems: "center", gap: 28 * u }}>
        {subject && <Badge item={subject} theme={theme} u={u} t={tSubject} fill={fill} />}
        {subject && target && arrow}
        {object && <Badge item={object} theme={theme} u={u} t={tObject} fill={fill} ring={result && tResult > 0.5 ? tone : undefined} />}
        {!object && result && <Badge item={result} theme={theme} u={u} t={tResult} fill={fill} ring={tone} />}
      </div>
      {object && resultMark}
    </div>
  )

  if (full) {
    const bg = Math.min(interpolate(frame, [0, 6], [0, 1], clamp), interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp))
    return (
      <AbsoluteFill style={{ opacity: bg, background: theme.background, paddingTop: Math.max(96 * u, safe.top), paddingBottom: Math.max(96 * u, safe.bottom), paddingLeft: Math.max(64 * u, safe.left), paddingRight: Math.max(64 * u, safe.right), justifyContent: "center", alignItems: "center" }}>
        {content}
      </AbsoluteFill>
    )
  }
  return (
    <div style={zone}>
      <div style={{ opacity, padding: 40 * u, borderRadius: theme.radius * u, background: theme.card, boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.25)` }}>{content}</div>
    </div>
  )
}


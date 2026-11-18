// Marks over words and things: a marker block, a brush underline, a brush circle,
// handwriting, a handwritten checklist. Each wraps its content and sizes to it.
// Adapted from remocn marker-highlight, ink-underline, scribble-circle, handwrite
// and check-list (MIT, see LICENSE-remocn.md).
import "./fonts/fonts.css"
import React from "react"
import { interpolate, spring, useCurrentFrame } from "remotion"
import { BrushGrain, type BrushPoint, brushFilterId, brushRibbon, sampleCubic, sampleLine } from "./brush"
import { CLAMP, useClock, useStage } from "./common"
import { DEFAULT_STEP, hashRange, paperJitter, qf, qstep, steppedRamp } from "./stop-motion"

export const HAND_FONT = `"Cutroom Hand", cursive`

// ---------- marker ----------------------------------------------------------------

export type MarkerProps = {
  children: React.ReactNode
  /** Element frame the marker starts. */
  at?: number
  /** Marker colour; the accent by default. */
  color?: string
  /** Text colour once covered; the accent's foreground by default. */
  textColor?: string
  style?: React.CSSProperties
}

/** A marker block sweeps behind the words with a spring; put it inside a line of text. */
export function Marker({ children, at = 0, color, textColor, style }: MarkerProps) {
  const t = useClock(at)
  const { fps, theme, accent } = useStage()
  const scale = spring({ frame: t, fps, config: { damping: 14 } })
  const swap = interpolate(scale, [0.5, 0.8], [0, 1], CLAMP)
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      <span aria-hidden style={{ position: "absolute", inset: "0.04em -0.12em", background: color ?? accent, borderRadius: "0.08em", transformOrigin: "left center", transform: `scaleX(${scale})` }} />
      <span style={{ position: "relative", color: swap > 0.5 ? textColor ?? theme.accentForeground : undefined }}>{children}</span>
    </span>
  )
}

// ---------- brush marks ----------------------------------------------------------

type BrushMark = { at?: number; color?: string; strokeWidth?: number; grain?: number; seed?: string; step?: number }

/** A brush line sweeps under the words in a few stop-motion poses. */
export function InkUnderline({ children, at = 0, color, strokeWidth = 14, grain = 1, seed = "ink", step = DEFAULT_STEP, steps = 5, style }: BrushMark & { children: React.ReactNode; steps?: number; style?: React.CSSProperties }) {
  const frame = useCurrentFrame()
  const { u, accent } = useStage()
  const sw = strokeWidth * u
  const progress = steppedRamp(frame, at, at + steps * step, { step })
  // Drawn in a 1000-wide box stretched to the words: the stroke keeps its height.
  const W = 1000, mid = sw / 2 + 2, wobble = hashRange(`${seed}:w`, -1.2, 1.2) * u
  const d = brushRibbon(sampleCubic({ x: 2, y: mid }, { x: W * 0.3, y: mid + wobble }, { x: W * 0.7, y: mid - wobble }, { x: W - 2, y: mid + wobble * 0.6 }, 40), { strokeWidth: sw, pressure: 1, release: 0.15, progress })
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      {children}
      <svg viewBox={`0 0 ${W} ${sw + 4}`} preserveAspectRatio="none" style={{ position: "absolute", left: "-2%", width: "104%", top: "92%", height: sw + 4, overflow: "visible", opacity: progress > 0 ? 1 : 0 }} aria-hidden>
        <BrushGrain seed={seed} strokeWidth={sw} grain={grain} />
        <path d={d} fill={color ?? accent} opacity={0.9} filter={grain > 0 ? `url(#${brushFilterId(seed, sw, grain)})` : undefined} />
      </svg>
    </span>
  )
}

/**
 * A brush circle swept round a region `width` × `height` (px at 1080): wrap a word or a
 * number in it, or place it absolutely over a part of a picture.
 */
export function ScribbleCircle({ children, width, height, at = 0, color, strokeWidth = 14, grain = 1, seed = "scribble", step = DEFAULT_STEP, steps = 10, laps = 1.15, style }: BrushMark & { children?: React.ReactNode; width: number; height: number; steps?: number; laps?: number; style?: React.CSSProperties }) {
  const frame = useCurrentFrame()
  const { u, accent } = useStage()
  const sw = strokeWidth * u
  const W = width * u, H = height * u
  const progress = steppedRamp(frame, at, at + steps * step, { step })
  const count = Math.ceil(laps * 48)
  const cx = W / 2 + hashRange(`${seed}:cx`, -0.02, 0.02) * W, cy = H / 2 + hashRange(`${seed}:cy`, -0.02, 0.02) * H
  const spine: BrushPoint[] = Array.from({ length: count }, (_, i) => {
    const a = laps * Math.PI * 2 * (i / (count - 1)) - Math.PI * 0.6
    const k = 1 + hashRange(`${seed}:r${i}`, -0.035, 0.035)
    return { x: cx + (W / 2) * k * Math.cos(a), y: cy + (H / 2) * k * Math.sin(a) }
  })
  const d = brushRibbon(spine, { strokeWidth: sw, pressure: 0.2, release: 1, progress })
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: W, height: H, ...style }}>
      {children}
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: progress > 0 ? 1 : 0, pointerEvents: "none" }} aria-hidden>
        <BrushGrain seed={seed} strokeWidth={sw} grain={grain} />
        <path d={d} fill={color ?? accent} opacity={0.9} filter={grain > 0 ? `url(#${brushFilterId(seed, sw, grain)})` : undefined} />
      </svg>
    </span>
  )
}

// ---------- handwriting -----------------------------------------------------------

export type HandwriteProps = {
  text: string
  /** Font size, px at 1080. */
  size?: number
  color?: string
  at?: number
  /** Letters per stop-motion pose. */
  perStep?: number
  step?: number
  align?: "left" | "center"
  style?: React.CSSProperties
}

/** Frames `Handwrite` takes to write `text`. */
export function handwriteFrames(text: string, perStep = 1.6, step = DEFAULT_STEP) {
  return Math.ceil(Array.from(text).length / perStep) * step + step
}

/** Text laid down letter by letter, each glyph with its own slant and baseline. */
export function Handwrite({ text, size = 72, color, at = 0, perStep = 1.6, step = DEFAULT_STEP, align = "center", style }: HandwriteProps) {
  const frame = useCurrentFrame()
  const { u, ink } = useStage()
  const shown = Math.floor(Math.max(0, qstep(Math.max(0, qf(frame, step) - at), step)) * perStep)
  const fresh = shown - Math.ceil(perStep)
  return (
    <span style={{ display: "inline-block", fontFamily: HAND_FONT, fontWeight: 600, fontSize: size * u, lineHeight: 1.15, color: color ?? ink, whiteSpace: "pre-wrap", textAlign: align, ...style }}>
      {Array.from(text).map((ch, i) => {
        const on = i < shown
        return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: on ? 1 : 0, transform: on ? `translateY(${hashRange(`hw:${text}:${i}:y`, -1.8, 1.8) * u}px) rotate(${hashRange(`hw:${text}:${i}:r`, -3.2, 3.2)}deg) scale(${i >= fresh ? 1.06 : 1})` : undefined }}>{ch}</span>
      })}
    </span>
  )
}

// ---------- checklist -------------------------------------------------------------

export type CheckListProps = {
  /** Lines of the list; `done: true` gets ticked and struck through after the list is written. */
  items: { text: string; done?: boolean }[]
  /** Font size, px at 1080. */
  size?: number
  color?: string
  /** Colour of the ticks and strikes; the accent by default. */
  markColor?: string
  at?: number
  perStep?: number
  step?: number
  style?: React.CSSProperties
}

/** A handwritten list writes itself out, then ticks and strikes the done items one by one. */
export function CheckList({ items, size = 88, color, markColor, at = 0, perStep = 1.6, step = DEFAULT_STEP, style }: CheckListProps) {
  const frame = useCurrentFrame()
  const { u, ink, accent } = useStage()
  const fs = size * u
  const mark = markColor ?? accent
  // Each line starts when the one above is written.
  const starts: number[] = []
  let clock = at
  for (const item of items) { starts.push(clock); clock += handwriteFrames(item.text, perStep, step) }
  let tickAt = clock + step * 2
  const ticks = items.map((item) => {
    if (!item.done) return null
    const start = tickAt
    tickAt += step * 5
    return start
  })
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: fs * 0.32, ...style }}>
      {items.map((item, i) => {
        const tick = ticks[i]
        const tickP = tick === null ? 0 : steppedRamp(frame, tick, tick + step * 2, { step })
        const strikeP = tick === null ? 0 : steppedRamp(frame, tick + step * 2, tick + step * 4, { step })
        const box = fs * 0.62
        const j = paperJitter(frame, `cl:${i}`, { amp: 0.8 * u })
        const tickD = brushRibbon(sampleLine({ x: box * 0.15, y: box * 0.5 }, { x: box * 0.42, y: box * 0.8 }, 6).concat(sampleLine({ x: box * 0.42, y: box * 0.8 }, { x: box * 1.05, y: box * -0.05 }, 8).slice(1)), { strokeWidth: fs * 0.11, pressure: 0.5, release: 1, progress: tickP })
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: fs * 0.3, opacity: frame >= starts[i] ? 1 : 0, transform: `translate(${j.x}px, ${j.y}px) rotate(${j.rot}deg)` }}>
            <svg width={box} height={box} style={{ flex: "none", overflow: "visible" }} aria-hidden>
              <rect x={1} y={1} width={box - 2} height={box - 2} rx={box * 0.12} fill="none" stroke={color ?? ink} strokeWidth={Math.max(2, fs * 0.05)} opacity={0.8} />
              {tickP > 0 ? <path d={tickD} fill={mark} /> : null}
            </svg>
            <span style={{ position: "relative" }}>
              <Handwrite text={item.text} size={size} color={color} at={starts[i]} perStep={perStep} step={step} align="left" />
              {strikeP > 0 ? <span aria-hidden style={{ position: "absolute", left: "-2%", top: "55%", height: fs * 0.08, width: `${104 * strikeP}%`, background: mark, borderRadius: fs, transform: "rotate(-1.5deg)" }} /> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

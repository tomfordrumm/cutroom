// Text scenes: numbered steps, a pull quote, a two-beat hook, a POV setup and an
// acronym that expands into its words. Laid out for vertical frames first.
// After remocn three-steps, quote-hero, hook-punch, pov-setup and acronym-expand (MIT).
import React from "react"
import { Easing, interpolate, spring } from "remotion"
import { CLAMP, kick, ramp, tint, useClock, useStage } from "./common"

const SLAM = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)

// ---------- steps -----------------------------------------------------------------

export type StepsProps = {
  /** 2–5 short steps, top to bottom. */
  steps: string[]
  /** A line under each step, optional. */
  notes?: string[]
  /** Small line above the list. */
  eyebrow?: string
  /** Width of the block, px at 1080. */
  width?: number
  at?: number
  /** Frames between steps. */
  every?: number
  style?: React.CSSProperties
}

/** Numbered nodes light one by one along a line that draws down between them. */
export function Steps({ steps, notes = [], eyebrow, width = 900, at = 0, every = 14, style }: StepsProps) {
  const t = useClock(at)
  const { u, fps, ink, mute, line, accent, theme, font, display } = useStage()
  const W = width * u
  const node = 96 * u
  const rowH = node * 1.9
  const list = steps.slice(0, 5)
  const lineP = interpolate(t, [6, 6 + every * (list.length - 1) + 4], [0, 1], { ...CLAMP, easing: IO })
  return (
    <div style={{ position: "relative", width: W, ...style }}>
      {eyebrow ? <div style={{ fontFamily: font, fontWeight: 700, fontSize: 30 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: mute, marginBottom: 36 * u, opacity: ramp(t, 0, 8) }}>{eyebrow}</div> : null}
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: node / 2 - 2 * u, top: node / 2, width: 4 * u, height: rowH * (list.length - 1), background: line, borderRadius: 2 * u }} />
        <div style={{ position: "absolute", left: node / 2 - 2 * u, top: node / 2, width: 4 * u, height: rowH * (list.length - 1) * lineP, background: accent, borderRadius: 2 * u }} />
        {list.map((step, i) => {
          const s = spring({ frame: t - 6 - i * every, fps, config: { damping: 13, stiffness: 170, mass: 0.7 } })
          const lit = Math.min(1, Math.max(0, s))
          const hit = kick(t - 6 - i * every, 7)
          return (
            <div key={i} style={{ position: "relative", height: rowH, display: "flex", alignItems: "flex-start", gap: 40 * u }}>
              <div style={{ flex: "none", width: node, height: node, borderRadius: node, display: "grid", placeItems: "center", background: lit > 0.5 ? accent : theme.background, border: `${4 * u}px solid ${lit > 0.05 ? accent : line}`, color: lit > 0.5 ? theme.accentForeground : mute, fontFamily: display, fontWeight: 800, fontSize: 48 * u, transform: `scale(${0.8 + 0.2 * lit + 0.1 * hit})` }}>{i + 1}</div>
              <div style={{ paddingTop: node * 0.12, opacity: lit, transform: `translateX(${(1 - lit) * 40 * u}px)` }}>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 60 * u, lineHeight: 1.05, letterSpacing: "-0.02em", color: ink }}>{step}</div>
                {notes[i] ? <div style={{ fontFamily: font, fontWeight: 500, fontSize: 34 * u, color: mute, marginTop: 10 * u }}>{notes[i]}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- quote -----------------------------------------------------------------

export type QuoteProps = {
  quote: string
  /** A phrase of the quote that gets the marker. */
  highlight?: string
  author: string
  /** Who the author is: «нутрициолог», «клиентка, 3 месяца». */
  role?: string
  /** Font size of the quote, px at 1080. */
  size?: number
  width?: number
  at?: number
  style?: React.CSSProperties
}

/** A pull quote: the mark drops, words rise, the key phrase gets a marker, the name signs off. */
export function Quote({ quote, highlight, author, role, size = 66, width = 900, at = 0, style }: QuoteProps) {
  const t = useClock(at)
  const { u, fps, ink, mute, accent, font, display } = useStage()
  const words = quote.split(/\s+/).filter(Boolean)
  const hl = highlight ? highlight.split(/\s+/).filter(Boolean) : []
  let hlFrom = -1
  if (hl.length) for (let i = 0; i + hl.length <= words.length; i++) if (hl.every((w, k) => words[i + k].replace(/[.,!?;:«»"]/g, "") === w.replace(/[.,!?;:«»"]/g, ""))) { hlFrom = i; break }
  const wordsEnd = 8 + words.length * 2
  const sweep = interpolate(t, [wordsEnd + 4, wordsEnd + 18], [0, 1], { ...CLAMP, easing: IO })
  const mark = spring({ frame: t, fps, config: { damping: 14, stiffness: 160 } })
  const sign = ramp(t, wordsEnd + 10, 12)
  return (
    <div style={{ position: "relative", width: width * u, ...style }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: size * 3 * u, lineHeight: 0.7, height: size * 1.4 * u, color: accent, transform: `translateY(${(1 - mark) * -40 * u}px)`, opacity: Math.min(1, mark) }}>“</div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: size * u, lineHeight: 1.18, letterSpacing: "-0.02em", color: ink }}>
        {words.map((w, i) => {
          const p = SLAM(ramp(t, 8 + i * 2, 10))
          const inHl = hlFrom >= 0 && i >= hlFrom && i < hlFrom + hl.length
          const local = inHl ? Math.min(1, Math.max(0, sweep * hl.length - (i - hlFrom))) : 0
          return (
            <span key={i} style={{ display: "inline-block", marginRight: "0.26em", position: "relative", opacity: p, transform: `translateY(${(1 - p) * 0.5}em)` }}>
              {inHl ? <span aria-hidden style={{ position: "absolute", left: "-0.08em", right: i < hlFrom + hl.length - 1 ? "-0.34em" : "-0.08em", top: "0.12em", bottom: "0.02em", background: tint(accent, 35), transformOrigin: "left", transform: `scaleX(${local})` }} /> : null}
              <span style={{ position: "relative" }}>{w}</span>
            </span>
          )
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 22 * u, marginTop: 48 * u, opacity: sign, transform: `translateY(${(1 - sign) * 16 * u}px)` }}>
        <div style={{ width: 56 * u, height: 4 * u, background: accent, borderRadius: 2 * u }} />
        <div>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: 38 * u, color: ink }}>{author}</div>
          {role ? <div style={{ fontFamily: font, fontWeight: 500, fontSize: 30 * u, color: mute }}>{role}</div> : null}
        </div>
      </div>
    </div>
  )
}

// ---------- hook ------------------------------------------------------------------

export type HookPunchProps = {
  /** 1–3 short lines that slam in one after another. */
  lead: string[]
  /** The payoff in the accent, bigger. */
  payoff: string
  size?: number
  width?: number
  at?: number
  /** Frames between beats. */
  beat?: number
  style?: React.CSSProperties
}

/** A hook in beats: the lead lines slam in one by one, they dim, the payoff lands big. */
export function HookPunch({ lead, payoff, size = 84, width = 940, at = 0, beat = 12, style }: HookPunchProps) {
  const t = useClock(at)
  const { u, ink, accent, display } = useStage()
  const payAt = lead.length * beat + 6
  const pay = SLAM(ramp(t, payAt, 8))
  const payHit = kick(t - payAt - 2, 8)
  const dim = ramp(t, payAt, 6)
  const fit = (text: string, fs: number) => Math.min(fs, (width * u * 0.98) / Math.max(1, text.length * 0.56))
  return (
    <div style={{ width: width * u, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u, textAlign: "center", ...style }}>
      {lead.map((line, i) => {
        const p = SLAM(ramp(t, i * beat, 7))
        return <div key={i} style={{ fontFamily: display, fontWeight: 800, fontSize: fit(line, size * u), lineHeight: 1.05, letterSpacing: "-0.02em", color: ink, opacity: p * (1 - 0.55 * dim), transform: `translateY(${(1 - p) * 50 * u}px) scale(${1.15 - 0.15 * p + 0.04 * kick(t - i * beat - 2, 6)})` }}>{line}</div>
      })}
      <div style={{ marginTop: 30 * u, fontFamily: display, fontWeight: 900, fontSize: fit(payoff, size * 1.5 * u), lineHeight: 1, letterSpacing: "-0.03em", color: accent, opacity: pay, transform: `scale(${(1.4 - 0.4 * pay) * (1 + 0.05 * payHit)})`, filter: pay < 0.98 ? `blur(${(1 - pay) * 10 * u}px)` : undefined }}>{payoff}</div>
    </div>
  )
}

// ---------- POV -------------------------------------------------------------------

export type PovProps = {
  /** The situation after «POV:», word by word. */
  setup: string
  /** The punchline in the display face and the accent. */
  punchline: string
  label?: string
  size?: number
  width?: number
  at?: number
  style?: React.CSSProperties
}

/** «POV:» lands as a chip, the setup slides in word by word, the punchline drops last. */
export function Pov({ setup, punchline, label = "POV:", size = 64, width = 900, at = 0, style }: PovProps) {
  const t = useClock(at)
  const { u, fps, theme, ink, accent, font, display } = useStage()
  const words = setup.split(/\s+/).filter(Boolean)
  const chip = spring({ frame: t, fps, config: { damping: 12, stiffness: 200 } })
  const punchAt = 10 + words.length * 3 + 10
  const punch = SLAM(ramp(t, punchAt, 10))
  return (
    <div style={{ width: width * u, ...style }}>
      <div style={{ display: "inline-block", padding: `${10 * u}px ${24 * u}px`, borderRadius: 14 * u, background: ink, color: theme.background, fontFamily: font, fontWeight: 800, fontSize: 40 * u, transform: `scale(${chip}) rotate(${(1 - chip) * -8}deg)`, transformOrigin: "left center" }}>{label}</div>
      <div style={{ marginTop: 30 * u, fontFamily: font, fontWeight: 700, fontSize: size * u, lineHeight: 1.2, color: ink }}>
        {words.map((w, i) => {
          const p = SLAM(ramp(t, 10 + i * 3, 8))
          return <span key={i} style={{ display: "inline-block", marginRight: "0.28em", opacity: p, transform: `translateX(${(1 - p) * 30 * u}px)` }}>{w}</span>
        })}
      </div>
      <div style={{ marginTop: 40 * u, fontFamily: display, fontWeight: 800, fontStyle: "italic", fontSize: size * 1.35 * u, lineHeight: 1.08, color: accent, opacity: punch, transform: `translateY(${(1 - punch) * -40 * u}px)` }}>{punchline}</div>
    </div>
  )
}

// ---------- acronym ---------------------------------------------------------------

export type AcronymProps = {
  /** The words, one per letter of the acronym: ["Белки", "Жиры", "Углеводы"]. */
  words: string[]
  /** Small line above. */
  eyebrow?: string
  /** A line under the expanded words. */
  caption?: string
  width?: number
  at?: number
  /** Frame (from `at`) the letters start travelling to their words. */
  expandAt?: number
  style?: React.CSSProperties
}

/** The acronym stands big, then each letter travels down to start its word and the word writes out. */
export function Acronym({ words, eyebrow, caption, width = 900, at = 0, expandAt = 24, style }: AcronymProps) {
  const t = useClock(at)
  const { u, fps, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const n = Math.max(1, words.length)
  const rowFs = 92 * u
  const rowH = rowFs * 1.25
  const big = Math.min(300 * u, (W * 0.9) / (n * 0.75), rowH * n * 0.9)
  const rowsH = rowH * n
  const x0 = W * 0.08
  const appear = spring({ frame: t, fps, config: { damping: 14, stiffness: 140 } })
  return (
    <div style={{ width: W, ...style }}>
      {eyebrow ? <div style={{ fontFamily: font, fontWeight: 700, fontSize: 30 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: mute, textAlign: "center", marginBottom: 40 * u, opacity: ramp(t, 0, 8) }}>{eyebrow}</div> : null}
      <div style={{ position: "relative", height: rowsH }}>
        {words.map((word, i) => {
          const chars = Array.from(word)
          const go = interpolate(t, [expandAt + i * 5, expandAt + i * 5 + 16], [0, 1], { ...CLAMP, easing: IO })
          const restP = ramp(t, expandAt + i * 5 + 12, 10)
          // The letter lands at the start of its row; it begins big, in a line across the middle.
          const rowTop = rowH * i
          const startLeft = W / 2 + (i - n / 2) * big * 0.78
          const startTop = rowsH / 2 - big * 0.55
          const k = big / rowFs
          const dx = (startLeft - x0) * (1 - go), dy = (startTop - rowTop) * (1 - go), sc = k + (1 - k) * go
          return (
            <div key={i} style={{ position: "absolute", left: x0, top: rowTop, height: rowH, display: "flex", alignItems: "center", fontFamily: display, fontWeight: 800, fontSize: rowFs, lineHeight: 1, whiteSpace: "nowrap" }}>
              <span style={{ display: "inline-block", color: go > 0.98 ? accent : ink, transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sc * (0.85 + 0.15 * appear)})`, opacity: Math.min(1, appear), fontWeight: 900 }}>{chars[0]}</span>
              <span style={{ color: ink, opacity: restP, transform: `translateX(${(1 - restP) * 30 * u}px)` }}>{chars.slice(1).join("")}</span>
            </div>
          )
        })}
      </div>
      {caption ? <div style={{ marginTop: 24 * u, marginLeft: x0, fontFamily: font, fontWeight: 500, fontSize: 38 * u, color: mute, opacity: ramp(t, expandAt + n * 5 + 20, 10) }}>{caption}</div> : null}
    </div>
  )
}

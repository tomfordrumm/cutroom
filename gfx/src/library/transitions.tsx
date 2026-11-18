// Transitions between two scenes of one component. `Transition` takes both scenes
// and draws the cut between `start` and `end`; `whipPan` gives bare styles.
// Adapted from remocn whip-pan, zoom-blur, push-through, focus-pull, page-turn,
// paper-tear and light-leak (MIT, see LICENSE-remocn.md).
import React, { type CSSProperties, type ReactNode } from "react"
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { CLAMP, useStage } from "./common"

export type Direction = "left" | "right" | "up" | "down"
export type SceneStyles = { out: CSSProperties; in: CSSProperties }

/**
 * A whip pan: both scenes fly through the frame in one move with motion blur.
 * `out` goes on the scene that leaves, `in` on the one that arrives; render both
 * between `start` and `end`, only the new one after.
 */
export function whipPan(frame: number, start: number, end: number, { direction = "left", blur = 24, u = 1 }: { direction?: Direction; blur?: number; u?: number } = {}): SceneStyles {
  const travel = interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...CLAMP, easing: Easing.bezier(0.7, 0, 0.2, 1) })
  const velocity = Math.sin(Math.PI * travel)
  const horizontal = direction === "left" || direction === "right"
  const sign = direction === "left" || direction === "up" ? -1 : 1
  const stretch = 1 + velocity * 0.12
  const style = (offset: number): CSSProperties => ({
    transform: `${horizontal ? `translateX(${offset}%)` : `translateY(${offset}%)`} ${horizontal ? `scaleX(${stretch})` : `scaleY(${stretch})`}`,
    filter: velocity > 0.01 ? `blur(${velocity * blur * u}px)` : undefined,
  })
  return { out: style(travel * 110 * sign), in: style((travel - 1) * 110 * sign) }
}

function zoomBlur(p: number, blur: number): SceneStyles {
  return {
    out: { opacity: 1 - p, transform: `scale(${1 + p * 0.12})`, filter: p > 0 ? `blur(${p * blur}px)` : undefined },
    in: { opacity: p, transform: `scale(${0.9 + p * 0.1})`, filter: p < 1 ? `blur(${(1 - p) * blur}px)` : undefined },
  }
}

function pushThrough(p: number, blur: number): SceneStyles {
  return {
    out: { opacity: interpolate(p, [0.4, 0.62], [1, 0], { ...CLAMP, easing: Easing.bezier(0.42, 0, 0.58, 1) }), transform: `scale(${interpolate(p, [0, 0.65], [1, 2.4], { ...CLAMP, easing: Easing.in(Easing.cubic) })})`, filter: `blur(${interpolate(p, [0.15, 0.6], [0, blur], CLAMP)}px)` },
    in: { opacity: interpolate(p, [0.3, 0.5], [0, 1], CLAMP), transform: `scale(${interpolate(p, [0.3, 0.88, 1], [0.68, 1.02, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) })})`, filter: `blur(${interpolate(p, [0.3, 0.75], [blur * 0.7, 0], CLAMP)}px)` },
  }
}

function focusPull(p: number, blur: number): SceneStyles {
  return {
    out: { opacity: interpolate(p, [0.42, 0.68], [1, 0], CLAMP), transform: `scale(${interpolate(p, [0, 0.6], [1, 1.05], CLAMP)})`, filter: `blur(${interpolate(p, [0.05, 0.55], [0, blur], { ...CLAMP, easing: Easing.in(Easing.quad) })}px) brightness(${interpolate(p, [0.1, 0.55], [1, 1.3], CLAMP)})` },
    in: { opacity: interpolate(p, [0.32, 0.52], [0, 1], CLAMP), transform: `scale(${interpolate(p, [0.35, 1], [0.97, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) })})`, filter: `blur(${interpolate(p, [0.35, 0.9], [blur, 0], { ...CLAMP, easing: Easing.out(Easing.quad) })}px) brightness(${interpolate(p, [0.4, 0.85], [1.25, 1], CLAMP)})` },
  }
}

/** The old scene swings up and away like a notebook page, in stop-motion poses. */
function pageTurn(p: number, height: number, poses = 8): SceneStyles {
  const eased = Easing.in(Easing.cubic)(p)
  const pose = Math.min(poses - 1, Math.floor(eased * poses)) / (poses - 1)
  return { out: { zIndex: 2, transformOrigin: "18% 100%", transform: `translateY(${-pose * height * 1.28}px) rotate(${-7 * pose}deg)` }, in: {} }
}

// ---------- light leak ------------------------------------------------------------

const FLARES = [
  { along: 0, across: 0.3, size: 0.85, alpha: 1 },
  { along: -0.18, across: 0.78, size: 0.7, alpha: 0.85 },
  { along: 0.12, across: 0.55, size: 0.55, alpha: 0.9 },
  { along: -0.32, across: 0.12, size: 0.6, alpha: 0.7 },
  { along: 0.05, across: 0.95, size: 0.5, alpha: 0.6 },
]

function LightLeakLayer({ p, colors, from = "left" }: { p: number; colors: string[]; from?: Direction }) {
  const { width, height } = useVideoConfig()
  const heat = p <= 0.5 ? Easing.in(Easing.quad)(p / 0.5) : 1 - Easing.out(Easing.quad)((p - 0.5) / 0.5)
  const span = Math.max(width, height)
  const drift = interpolate(p, [0, 1], [-0.25, 1.05], { easing: Easing.bezier(0.3, 0.1, 0.5, 0.9) })
  const blowout = colors[colors.length - 1]
  const flash = Math.exp(-(((p - 0.5) / 0.1) ** 2))
  const horizontal = from === "left" || from === "right"
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 3 }}>
      {FLARES.map((f, i) => {
        let along = drift + f.along
        if (from === "right" || from === "down") along = 1 - along
        const x = (horizontal ? along : f.across) * width, y = (horizontal ? f.across : along) * height
        const color = colors[i % Math.max(1, colors.length - 1)]
        return <AbsoluteFill key={i} style={{ mixBlendMode: "screen", opacity: Math.min(1, Math.sqrt(heat) * f.alpha * 1.1), background: `radial-gradient(circle ${span * f.size}px at ${x}px ${y}px, color-mix(in srgb, ${color} 55%, ${blowout}) 0%, ${color} 22%, color-mix(in srgb, ${color} 55%, transparent) 45%, transparent 72%)` }} />
      })}
      <AbsoluteFill style={{ backgroundColor: blowout, opacity: Math.min(0.96, flash) }} />
    </AbsoluteFill>
  )
}

// ---------- paper tear ------------------------------------------------------------

const STRAIN = 0.2, IMPACT = 0.28, SEGMENTS = 44

function PaperTear({ p, from, to, seed = 7, edgeColor = "#FFFFFF" }: { p: number; from: ReactNode; to: ReactNode; seed?: number | string; edgeColor?: string }) {
  const { width, height, fps } = useVideoConfig()
  const unit = Math.min(width, height)
  const r = 0.5
  const tilt = (random(`tear-tilt-${seed}`) - 0.5) * width * 0.08
  const pa = random(`tear-pa-${seed}`) * Math.PI * 2, pb = random(`tear-pb-${seed}`) * Math.PI * 2
  const fiber = unit * (0.008 + r * 0.012)
  const tear = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const t = i / SEGMENTS
    const wander = Math.sin(t * Math.PI * 2.2 + pa) * width * 0.025 + Math.sin(t * Math.PI * 5.3 + pb) * width * 0.012
    const zig = (i % 2 === 0 ? 1 : -1) * random(`tear-z-${seed}-${i}`)
    return { x: width / 2 + tilt * (t - 0.5) + wander * (0.4 + r) + zig * unit * 0.022 * r, y: -unit * 0.05 + t * (height + unit * 0.1), left: fiber * (0.35 + random(`tear-l-${seed}-${i}`) * 1.3), right: fiber * (0.2 + random(`tear-r-${seed}-${i}`) * 0.9) }
  })
  const t0 = p - IMPACT
  const amp = t0 < 0 ? 0 : unit * 0.03 * Math.exp(-t0 * 11)
  const shake = { x: t0 < 0 ? 0 : Math.sin(t0 * 95) * amp, y: t0 < 0 ? 0 : Math.cos(t0 * 120 + 0.6) * amp * 0.7 }
  const strain = interpolate(p, [0, STRAIN, IMPACT], [0, 1, 1], { ...CLAMP, easing: Easing.in(Easing.cubic) })
  const tremble = p < IMPACT ? Math.sin(p * 260) * unit * 0.004 * strain : 0
  const front = -unit * 0.1 + Easing.in(Easing.quad)(interpolate(p, [STRAIN, IMPACT], [0, 1], CLAMP)) * (height + unit * 0.25)
  const open = (y: number) => interpolate(front - y, [0, unit * 0.12], [0, 1], CLAMP)
  const pt = (x: number, y: number) => `${x}px ${y}px`
  const pad = unit
  const edge = tear.map((t) => pt(t.x, t.y))
  const leftInk = tear.map((t) => pt(t.x - t.left * open(t.y), t.y))
  const rightInk = tear.map((t) => pt(t.x + t.right * open(t.y), t.y))
  const lo = [pt(-pad, height + pad), pt(-pad, -pad)], ro = [pt(width + pad, height + pad), pt(width + pad, -pad)]
  const poly = (pts: string[]) => `polygon(${pts.join(",")})`
  const peel = spring({ frame: Math.max(0, (p - IMPACT) / (1 - IMPACT)) * 30, fps, durationInFrames: 30, config: { damping: 15, stiffness: 150, mass: 0.8 } })
  const maxX = Math.max(...tear.map((t) => t.x)), minX = Math.min(...tear.map((t) => t.x))
  const curl = peel * 24
  const lens = `perspective(${unit * 2.6}px)`
  const cast = interpolate(p, [IMPACT, IMPACT + 0.1], [0, 1], CLAMP)
  const shadow = `drop-shadow(0 ${unit * 0.012 * cast}px ${unit * 0.04 * cast}px rgba(0,0,0,0.45))`
  const half = (paper: string, print: string, transform: string, origin: string) => (
    <AbsoluteFill style={{ transform, transformOrigin: origin, filter: cast > 0 ? shadow : undefined }}>
      <AbsoluteFill style={{ clipPath: paper, backgroundColor: edgeColor }} />
      <AbsoluteFill style={{ clipPath: print }}>{from}</AbsoluteFill>
    </AbsoluteFill>
  )
  const scale = interpolate(p, [IMPACT, 1], [1.1, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) })
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) scale(${scale})` }}>{to}</AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${shake.x + tremble}px, ${shake.y}px) scale(${1 + 0.025 * strain * (p < IMPACT ? 1 : 0)})` }}>
        {half(poly([...edge, ...lo]), poly([...leftInk, ...lo]), `${lens} translateX(${-peel * (maxX + unit * 0.12) * 1.3}px) rotateY(${curl}deg)`, "0% 50%")}
        {half(poly([...edge, ...ro]), poly([...rightInk, ...ro]), `${lens} translateX(${peel * (width - minX + unit * 0.12) * 1.3}px) rotateY(${-curl}deg)`, "100% 50%")}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------- the component ---------------------------------------------------------

export type TransitionKind = "whip" | "zoomBlur" | "pushThrough" | "focusPull" | "pageTurn" | "paperTear" | "lightLeak"

export type TransitionProps = {
  kind: TransitionKind
  /** The scene that leaves. */
  from: ReactNode
  /** The scene that arrives. */
  to: ReactNode
  /** Element frames of the transition. */
  start: number
  end: number
  /** whip and lightLeak: where the move comes from. */
  direction?: Direction
  /** Blur of zoomBlur, pushThrough, focusPull and whip, px at 1080. */
  blur?: number
  /** paperTear: another seed — another rip. */
  seed?: number | string
}

/**
 * The cut between two scenes of one component, drawn full frame: before `start`
 * only `from`, after `end` only `to`. Lengths: whip 10–14 frames, zoomBlur and
 * focusPull 12–18, pushThrough 16–22, pageTurn 14–20, paperTear 24–36, lightLeak 18–30.
 */
export function Transition({ kind, from, to, start, end, direction = "left", blur = 16, seed }: TransitionProps) {
  const frame = useCurrentFrame()
  const { u, height, accent, theme } = useStage()
  // Under both scenes: a cross-fade must not let the video show through.
  const ground = <AbsoluteFill style={{ background: theme.background }} />
  if (frame < start) return <AbsoluteFill>{from}</AbsoluteFill>
  if (frame >= end) return <AbsoluteFill>{to}</AbsoluteFill>
  const p = interpolate(frame, [start, end], [0, 1], CLAMP)
  if (kind === "paperTear") return <AbsoluteFill>{ground}<PaperTear p={p} from={from} to={to} seed={seed} /></AbsoluteFill>
  if (kind === "lightLeak") {
    return (
      <AbsoluteFill>
        <AbsoluteFill>{p < 0.5 ? from : to}</AbsoluteFill>
        <LightLeakLayer p={p} from={direction} colors={[accent, `color-mix(in srgb, ${accent} 60%, #FF5A1F)`, "#FFB347", "#FFF3E0"]} />
      </AbsoluteFill>
    )
  }
  const s = kind === "whip" ? whipPan(frame, start, end, { direction, blur: blur * 1.5, u })
    : kind === "zoomBlur" ? zoomBlur(p, blur * u)
    : kind === "pushThrough" ? pushThrough(p, blur * u)
    : kind === "focusPull" ? focusPull(p, blur * u)
    : pageTurn(p, height)
  return (
    <AbsoluteFill>
      {ground}
      <AbsoluteFill style={s.in}>{to}</AbsoluteFill>
      <AbsoluteFill style={s.out}>{from}</AbsoluteFill>
    </AbsoluteFill>
  )
}

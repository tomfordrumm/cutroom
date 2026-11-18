// Physical effects around your own content: a heavy slam with a camera jolt, a 3D
// turntable, confetti, crumple and toss, a comic-page break, a blueprint wipe.
// After remocn impact-shake, turntable, confetti, crumple-toss, comic-panels and
// blueprint (MIT, see LICENSE-remocn.md).
import React from "react"
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame } from "remotion"
import { CLAMP, kick, mix, ramp, tint, useClock, useStage } from "./common"
import { hashRange, qf } from "./stop-motion"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)
type Base = { at?: number; style?: React.CSSProperties }

// ---------- impact ----------------------------------------------------------------

/** The content slams in from above with a squash, the frame jolts, dust kicks out sideways. */
export function Impact({ children, at = 0, intensity = 1, style }: Base & { children: React.ReactNode; intensity?: number }) {
  const t = useClock(at)
  const { u, ink } = useStage()
  const HIT = 7
  const fall = Easing.in(Easing.quad)(Math.min(1, t / HIT))
  const after = t - HIT
  const squash = after >= 0 ? Math.exp(-after * 0.35) * Math.cos(after * 0.9) * 0.22 * intensity : 0
  const amp = after >= 0 ? Math.exp(-after * 0.3) * 26 * u * intensity : 0
  const shakeX = Math.sin(after * 2.7) * amp, shakeY = Math.cos(after * 3.3) * amp * 0.6
  const rgb = after >= 0 && after < 2 ? 6 * u * intensity : 0
  const dust = after >= 0 ? ramp(after, 0, 16) : 0
  return (
    <div style={{ position: "relative", display: "inline-block", transform: `translate(${shakeX}px, ${shakeY}px)`, ...style }}>
      <div style={{ transformOrigin: "50% 100%", transform: `translateY(${(1 - fall) * -900 * u}px) scale(${1 + squash}, ${1 - squash})`, filter: rgb ? `drop-shadow(${rgb}px 0 0 rgba(255,0,60,0.7)) drop-shadow(${-rgb}px 0 0 rgba(0,200,255,0.7))` : undefined }}>{children}</div>
      {after >= 0 ? Array.from({ length: 10 }, (_, i) => {
        const side = i % 2 ? 1 : -1
        const dist = (80 + random(`dust-${i}`) * 160) * u * OUT(dust)
        return <div key={i} style={{ position: "absolute", bottom: -10 * u, left: "50%", width: (30 + random(`dsz-${i}`) * 40) * u, height: (30 + random(`dsz-${i}`) * 40) * u, borderRadius: "50%", background: tint(ink, 25), transform: `translate(${-50 + side * 0}%, 0) translate(${side * (dist + 60 * u)}px, ${-random(`dy-${i}`) * 60 * u * dust}px) scale(${1 - dust * 0.6})`, opacity: (1 - dust) * 0.8 }} />
      }) : null}
    </div>
  )
}

// ---------- turntable -------------------------------------------------------------

/** A card turns on an invisible turntable in real 3D: front, edge, back; a shadow breathes under it. */
export function Turntable({ front, back, width = 620, height = 820, turns = 1, at = 0, spin = 60, style }: Base & { front: React.ReactNode; back?: React.ReactNode; width?: number; height?: number; turns?: number; spin?: number }) {
  const t = useClock(at)
  const { u, theme, ink } = useStage()
  const W = width * u, H = height * u
  const angle = interpolate(t, [6, 6 + spin], [0, 360 * turns * (back ? 0.5 : 1)], { ...CLAMP, easing: IO }) + Math.sin(t / 20) * 3
  const showBack = back && Math.cos((angle * Math.PI) / 180) < 0
  const face: React.CSSProperties = { position: "absolute", inset: 0, borderRadius: theme.radius * u, overflow: "hidden", backfaceVisibility: "hidden", background: theme.card, boxShadow: `inset 0 0 0 ${2 * u}px ${tint(ink, 10)}` }
  const shade = Math.abs(Math.sin((angle * Math.PI) / 180)) * 0.35
  return (
    <div style={{ position: "relative", width: W, height: H + 80 * u, perspective: 2400 * u, ...style }}>
      <div style={{ position: "absolute", left: "10%", right: "10%", bottom: 0, height: 40 * u, borderRadius: "50%", background: "rgba(0,0,0,0.25)", filter: `blur(${14 * u}px)`, transform: `scaleX(${0.6 + 0.4 * Math.abs(Math.cos((angle * Math.PI) / 180))})` }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformStyle: "preserve-3d", transform: `rotateY(${angle}deg) rotateX(4deg)` }}>
        <div style={{ ...face, opacity: showBack ? 0 : 1 }}>{front}<div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${shade})` }} /></div>
        {back ? <div style={{ ...face, transform: "rotateY(180deg)", opacity: showBack ? 1 : 0 }}>{back}<div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${shade})` }} /></div> : null}
      </div>
    </div>
  )
}

// ---------- confetti --------------------------------------------------------------

/** A seeded confetti burst over the whole frame, the same on every render. Put it last, at the top level. */
export function Confetti({ at = 0, count = 140, x = 0.5, y = 0.5, power = 17, gravity = 0.45, lifetime = 90, size = 18, colors, seed = 1 }: { at?: number; count?: number; x?: number; y?: number; power?: number; gravity?: number; lifetime?: number; size?: number; colors?: string[]; seed?: number }) {
  const tt = useCurrentFrame() - at
  const { u, width, height, accent, accent2, theme } = useStage()
  if (tt < 0 || tt > lifetime) return null
  const palette = colors ?? [accent, accent2, theme.foreground, "#FFD84D", "#FF6B6B"]
  const sc = height / 1280 * 1.6
  const opacity = Math.min(interpolate(tt, [0, 4], [0, 1], CLAMP), interpolate(tt, [lifetime * 0.7, lifetime], [1, 0], CLAMP))
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 5 }}>
      {Array.from({ length: count }, (_, i) => {
        const r = (k: string) => random(`confetti-${seed}-${i}-${k}`)
        const angle = r("a") * Math.PI * 2, speed = 0.35 + 0.65 * r("s")
        const vx = Math.cos(angle) * speed * power + (r("d") - 0.5) * 2, vy = Math.sin(angle) * speed * power
        const px = width * x + vx * tt * sc, py = height * y + (vy * tt + 0.5 * gravity * tt * tt) * sc
        const rot0 = r("r") * Math.PI * 2, spin = (r("p") - 0.5) * 0.6
        const w = size * u * (0.7 + 0.6 * r("z"))
        return <div key={i} style={{ position: "absolute", left: px, top: py, width: w, height: w * 0.62, borderRadius: 2, background: palette[Math.floor(r("c") * palette.length)], opacity, transform: `translate(-50%, -50%) rotate(${rot0 + spin * tt}rad) scaleX(${Math.cos(rot0 + spin * tt * 1.6)})` }} />
      })}
    </AbsoluteFill>
  )
}

// ---------- crumple ---------------------------------------------------------------

/**
 * The content crumples: it shrinks and twists with creases running over it, a paper
 * ball takes its place and is tossed out of frame on an arc.
 */
export function Crumple({ children, at = 0, direction = "right", ball = 220, style }: Base & { children: React.ReactNode; direction?: "left" | "right"; ball?: number }) {
  const t = useClock(at)
  const { u, theme } = useStage()
  const CRUSH = 16, HOLD = 5, TOSS = 24
  const crush = Math.min(1, qf(t, 2) / CRUSH)
  const swap = crush >= 0.7
  const fly = Math.max(0, t - CRUSH - HOLD) / TOSS
  const sign = direction === "right" ? 1 : -1
  const B = ball * u
  const x = fly * 1000 * u * sign, y = fly * -520 * u + fly * fly * 1500 * u
  // The ball: a lumpy outline with creases, in the card colour.
  const n = 16
  const outline = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, r = hashRange(`ball${i}`, 40, 50)
    return `${50 + Math.cos(a) * r}% ${50 + Math.sin(a) * r}%`
  }).join(",")
  const ballIn = swap ? Math.min(1, (crush - 0.7) / 0.3 + 0.4) : 0
  return (
    <div style={{ position: "relative", display: "inline-grid", placeItems: "center", ...style }}>
      <div style={{ gridArea: "1 / 1", opacity: swap ? 0 : 1, transform: `scale(${1 - 0.75 * OUT(crush)}) rotate(${crush * 25 * sign}deg) skewX(${Math.sin(qf(t, 2)) * 8 * crush}deg)`, filter: `brightness(${1 - crush * 0.2})`, position: "relative" }}>
        {children}
        <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(${37 + qf(t, 2) * 23}deg, rgba(0,0,0,${0.18 * crush}) 0 ${5 * u}px, rgba(255,255,255,${0.14 * crush}) ${5 * u}px ${12 * u}px)`, mixBlendMode: "multiply", pointerEvents: "none" }} />
      </div>
      {swap ? (
        <div style={{ gridArea: "1 / 1", width: B, height: B, clipPath: `polygon(${outline})`, background: theme.card, transform: `translate(${x}px, ${y}px) rotate(${fly * 600 * sign + crush * 30}deg) scale(${ballIn * (1 - 0.35 * Math.min(1, fly))})`, opacity: fly > 0.9 ? 1 - (fly - 0.9) * 10 : 1 }}>
          <div style={{ position: "absolute", inset: 0, background: `conic-gradient(from 20deg, rgba(0,0,0,0.22), rgba(0,0,0,0.04) 15%, rgba(0,0,0,0.25) 30%, rgba(255,255,255,0.1) 45%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.05) 75%, rgba(0,0,0,0.2) 90%, rgba(0,0,0,0.22))` }} />
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), transparent 45%), radial-gradient(circle at 70% 75%, rgba(0,0,0,0.3), transparent 50%)` }} />
        </div>
      ) : null}
    </div>
  )
}

// ---------- comic -----------------------------------------------------------------

/**
 * The frame cracks into a three-panel comic page with halftone and speed lines,
 * then the action panel bursts full frame with a starburst word. Full frame: draws its own ground.
 */
export function ComicPanels({ panels, word = "БАМ!", at = 0, burstAt = 40 }: { panels: [React.ReactNode, React.ReactNode, React.ReactNode]; word?: string; at?: number; burstAt?: number }) {
  const t = useClock(at)
  const { u, fps, width, height, accent, theme, display } = useStage()
  const pad = 26 * u, gutter = 18 * u
  const crack = spring({ frame: t, fps, config: { damping: 18, stiffness: 160 } })
  const burst = spring({ frame: t - burstAt, fps, config: { damping: 12, stiffness: 160 } })
  const b = Math.min(1, Math.max(0, burst))
  const W = width - pad * 2, H = height - pad * 2
  const rects = [
    { x: pad, y: pad, w: W, h: H * 0.34 },
    { x: pad, y: pad + H * 0.34 + gutter, w: W * 0.42, h: H * 0.66 - gutter },
    { x: pad + W * 0.42 + gutter, y: pad + H * 0.34 + gutter, w: W * 0.58 - gutter, h: H * 0.66 - gutter },
  ]
  const full = { x: 0, y: 0, w: width, h: height }
  const star = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 0.62 : 1; return `${50 + Math.cos(a) * 50 * r}% ${50 + Math.sin(a) * 50 * r}%` }).join(",")
  return (
    <AbsoluteFill style={{ background: "#111" }}>
      {rects.map((r, i) => {
        const hot = i === 2
        const s = Math.min(1, Math.max(0, spring({ frame: t - i * 4, fps, config: { damping: 15, stiffness: 180 } })))
        const R = hot ? { x: r.x + (full.x - r.x) * b, y: r.y + (full.y - r.y) * b, w: r.w + (full.w - r.w) * b, h: r.h + (full.h - r.h) * b } : r
        return (
          <div key={i} style={{ position: "absolute", left: R.x, top: R.y, width: R.w, height: R.h, overflow: "hidden", background: theme.card, border: `${6 * u * (hot ? 1 - b : 1)}px solid #111`, transform: `rotate(${(1 - s) * (i - 1) * 6 * crack}deg) scale(${0.9 + 0.1 * s})`, zIndex: hot ? 2 : 1 }}>
            {panels[i]}
            <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${tint(accent, 55)} ${2.4 * u}px, transparent ${2.6 * u}px)`, backgroundSize: `${12 * u}px ${12 * u}px`, mixBlendMode: "multiply", opacity: 0.5 }} />
            {hot ? <div style={{ position: "absolute", inset: 0, background: `repeating-conic-gradient(from 0deg at 50% 50%, ${tint("#000", 18)} 0deg 2deg, transparent 2deg 9deg)`, opacity: 0.4 + 0.4 * b }} /> : null}
          </div>
        )
      })}
      <div style={{ position: "absolute", left: "50%", top: "48%", zIndex: 3, width: 640 * u, height: 460 * u, transform: `translate(-50%, -50%) rotate(-8deg) scale(${b * (1 + 0.08 * kick(t - burstAt - 3, 6))})`, clipPath: `polygon(${star})`, background: "#FFD84D", display: "grid", placeItems: "center" }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 130 * u, color: accent, WebkitTextStroke: `${6 * u}px #111`, letterSpacing: "-0.02em" }}>{word}</div>
      </div>
    </AbsoluteFill>
  )
}

// ---------- blueprint -------------------------------------------------------------

/** The content wipes into a technical drawing: blue grid, white lines, dimension marks, labels. */
export function Blueprint({ children, width = 760, height = 760, labels = [], dimensions, at = 0, wipeAt = 14, style }: Base & { children: React.ReactNode; width?: number; height?: number; labels?: { x: number; y: number; text: string }[]; dimensions?: { width: string; height: string }; wipeAt?: number }) {
  const t = useClock(at)
  const { u, font, accent } = useStage()
  const W = width * u, H = height * u
  const wipe = interpolate(t, [wipeAt, wipeAt + 20], [0, 100], { ...CLAMP, easing: IO })
  const lines = ramp(t, wipeAt + 16, 12)
  const BLUE = "#1C4E9E"
  const dimStyle: React.CSSProperties = { position: "absolute", fontFamily: font, fontWeight: 700, fontSize: 30 * u, color: "#FFFFFF", whiteSpace: "nowrap" }
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      <div style={{ position: "absolute", inset: -60 * u, clipPath: `inset(0 ${100 - wipe}% 0 0)`, background: BLUE, backgroundImage: `linear-gradient(rgba(255,255,255,0.12) ${1.5 * u}px, transparent ${1.5 * u}px), linear-gradient(90deg, rgba(255,255,255,0.12) ${1.5 * u}px, transparent ${1.5 * u}px)`, backgroundSize: `${40 * u}px ${40 * u}px`, borderRadius: 18 * u }}>
        <div style={{ position: "absolute", inset: 60 * u, filter: "grayscale(1) invert(1) brightness(1.6) contrast(2.2)", mixBlendMode: "screen", opacity: 0.85 }}>{children}</div>
      </div>
      {dimensions ? (
        <div style={{ position: "absolute", inset: 0, opacity: lines, pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: -40 * u, height: 2 * u, background: "#FFF" }} />
          <div style={{ ...dimStyle, left: "50%", top: -88 * u, transform: "translateX(-50%)" }}>{dimensions.width}</div>
          <div style={{ position: "absolute", top: 0, bottom: 0, right: -40 * u, width: 2 * u, background: "#FFF" }} />
          <div style={{ ...dimStyle, right: -54 * u, top: "50%", transform: "translate(100%, -50%) rotate(90deg)", transformOrigin: "0 50%" }}>{dimensions.height}</div>
        </div>
      ) : null}
      {labels.map((l, i) => {
        const p = ramp(t, wipeAt + 22 + i * 6, 8)
        return (
          <div key={i} style={{ position: "absolute", left: l.x * W, top: l.y * H, opacity: p }}>
            <div style={{ width: 18 * u, height: 18 * u, borderRadius: 9 * u, background: accent, transform: "translate(-50%, -50%)", boxShadow: `0 0 0 ${6 * u}px rgba(255,255,255,0.35)` }} />
            <div style={{ position: "absolute", left: 24 * u, top: -24 * u, padding: `${6 * u}px ${14 * u}px`, background: "#FFFFFF", color: BLUE, fontFamily: font, fontWeight: 800, fontSize: 30 * u, borderRadius: 8 * u, whiteSpace: "nowrap", transform: `translateX(${(1 - p) * 20 * u}px)` }}>{l.text}</div>
          </div>
        )
      })}
    </div>
  )
}

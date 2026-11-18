// Pictures and video stills: a montage that splits into a grid, a polaroid,
// a zoom into a detail, a camera tour over a screenshot, a split screen.
// Pictures come as URLs from the element's props.files, or as your own drawing.
// After remocn grid-montage, polaroid, up-close, screenshot-tour, duet-split (MIT).
import React from "react"
import { Easing, Img, interpolate, spring, useCurrentFrame } from "remotion"
import { CLAMP, kick, ramp, tint, useClock, useStage } from "./common"
import { HAND_FONT } from "./marks"
import { paperJitter } from "./stop-motion"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)
type Base = { at?: number; style?: React.CSSProperties }
type Pic = string | React.ReactNode
const picture = (p: Pic, style: React.CSSProperties = {}) => typeof p === "string" ? <Img src={p} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style }} /> : <div style={{ position: "absolute", inset: 0, ...style }}>{p}</div>

// ---------- montage ---------------------------------------------------------------

/** One picture full, then on the beat it splits into a 2×2 and a 3×3 grid of the pictures. */
export function GridMontage({ pictures, width = 900, aspect = 4 / 5, beat = 14, at = 0, style }: Base & { pictures: Pic[]; width?: number; aspect?: number; beat?: number }) {
  const t = useClock(at)
  const { u, fps, theme } = useStage()
  const W = width * u, H = W / aspect
  const stage = t < beat * 2 ? 1 : t < beat * 4 ? 2 : 3
  const local = t - (stage === 1 ? 0 : stage === 2 ? beat * 2 : beat * 4)
  const gap = 10 * u
  const cells = stage * stage
  const cw = (W - gap * (stage - 1)) / stage, chh = (H - gap * (stage - 1)) / stage
  return (
    <div style={{ position: "relative", width: W, height: H, borderRadius: theme.radius * u, overflow: "hidden", background: theme.deep, ...style }}>
      {Array.from({ length: cells }, (_, i) => {
        const r = Math.floor(i / stage), c = i % stage
        const s = spring({ frame: local - (r + c) * 1.5, fps, config: { damping: 16, stiffness: 220 } })
        const pop = kick(local - (r + c) * 1.5, 6)
        return (
          <div key={`${stage}-${i}`} style={{ position: "absolute", left: c * (cw + gap), top: r * (chh + gap), width: cw, height: chh, overflow: "hidden", borderRadius: stage > 1 ? 10 * u : 0, transform: `scale(${(stage === 1 ? 1 : 0.85 + 0.15 * Math.min(1, s)) * (1 + 0.03 * pop)})`, opacity: stage === 1 ? 1 : Math.min(1, s * 2) }}>
            {picture(pictures[(i + stage) % pictures.length], { transform: `scale(${1.08 - 0.08 * ramp(local, 0, beat * 2)})` })}
          </div>
        )
      })}
    </div>
  )
}

// ---------- polaroid --------------------------------------------------------------

/** An instant photo drops on the desk with a handwritten caption; the picture develops. */
export function Polaroid({ picture: pic, caption, width = 620, tilt = -4, at = 0, style }: Base & { picture: Pic; caption?: string; width?: number; tilt?: number }) {
  const t = useClock(at)
  const frame = useCurrentFrame()
  const { u, fps } = useStage()
  const W = width * u
  const drop = spring({ frame: t, fps, config: { damping: 13, stiffness: 140 } })
  const develop = ramp(t, 8, 30)
  const j = paperJitter(frame, "polaroid", { amp: 0.8 * u, rotAmp: 0.25 })
  const capShown = caption ? Math.floor(Array.from(caption).length * ramp(t, 20, 20)) : 0
  return (
    <div style={{ width: W, padding: `${W * 0.05}px ${W * 0.05}px ${W * 0.2}px`, background: "#FBFAF6", boxShadow: `0 ${18 * u}px ${50 * u}px rgba(0,0,0,0.28)`, transform: `translate(${j.x}px, ${(1 - Math.min(1, drop)) * -200 * u + j.y}px) rotate(${tilt + (1 - Math.min(1, drop)) * 10 + j.rot}deg) scale(${1.15 - 0.15 * Math.min(1, drop)})`, opacity: Math.min(1, drop * 2), position: "relative", ...style }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", background: "#222" }}>
        {picture(pic, { filter: `sepia(${(1 - develop) * 0.6}) brightness(${0.4 + 0.6 * develop}) contrast(${0.8 + 0.2 * develop})` })}
      </div>
      {caption ? <div style={{ position: "absolute", left: 0, right: 0, bottom: W * 0.05, textAlign: "center", fontFamily: HAND_FONT, fontWeight: 600, fontSize: W * 0.085, color: "#2A2730" }}>{Array.from(caption).slice(0, capShown).join("")}</div> : null}
    </div>
  )
}

// ---------- up close --------------------------------------------------------------

/** A picture in a frame; the camera pushes into a detail, a ring marks it, the caption lands. */
export function UpClose({ picture: pic, focus = { x: 0.5, y: 0.5 }, zoom = 2.6, caption, width = 900, aspect = 4 / 5, at = 0, pushAt = 14, style }: Base & { picture: Pic; focus?: { x: number; y: number }; zoom?: number; caption?: string; width?: number; aspect?: number; pushAt?: number }) {
  const t = useClock(at)
  const { u, theme, accent, ink, font } = useStage()
  const W = width * u, H = W / aspect
  const p = interpolate(t, [pushAt, pushAt + 24], [0, 1], { ...CLAMP, easing: IO })
  const s = 1 + (zoom - 1) * p
  // Bring the focus to the centre, but never past the picture's edge.
  const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v))
  const tx = lim((0.5 - focus.x) * W * s * p, (W * (s - 1)) / 2), ty = lim((0.5 - focus.y) * H * s * p, (H * (s - 1)) / 2)
  const ring = ramp(t, pushAt + 24, 8)
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 * u, ...style }}>
      <div style={{ position: "relative", width: W, height: H, borderRadius: theme.radius * u, overflow: "hidden", boxShadow: `0 ${20 * u}px ${60 * u}px rgba(0,0,0,0.25)`, opacity: ramp(t, 0, 8) }}>
        <div style={{ position: "absolute", inset: 0, transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: "50% 50%" }}>{picture(pic)}</div>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: W * 0.34, height: W * 0.34, borderRadius: "50%", border: `${6 * u}px solid ${accent}`, transform: `translate(-50%, -50%) scale(${1.4 - 0.4 * OUT(ring)})`, opacity: ring, boxShadow: `0 0 0 ${2000 * u}px ${tint("#000000", 35 * ring)}` }} />
      </div>
      {caption ? <div style={{ fontFamily: font, fontWeight: 700, fontSize: 44 * u, color: ink, textAlign: "center", maxWidth: W, opacity: ramp(t, pushAt + 28, 10) }}>{caption}</div> : null}
    </div>
  )
}

// ---------- tour ------------------------------------------------------------------

export type TourStop = { x: number; y: number; w: number; h: number; label?: string }

/**
 * A camera tour over a picture (a screenshot, a document, a menu): it pulls to each
 * stop in turn (x, y, w, h — shares of the picture), dims the rest, labels the stop.
 */
export function Tour({ picture: pic, stops, aspect = 3 / 4, width = 940, every = 36, at = 0, style }: Base & { picture: Pic; stops: TourStop[]; aspect?: number; width?: number; every?: number }) {
  const t = useClock(at)
  const { u, theme, accent, font } = useStage()
  const W = width * u, H = W / aspect
  const all: TourStop[] = [{ x: 0, y: 0, w: 1, h: 1 }, ...stops]
  // Segment i moves from all[i] to stop i in the first 60 % of `every`, then holds on it.
  const local = Math.max(0, t - 10)
  const i = Math.min(stops.length - 1, Math.floor(local / every))
  const f = IO(Math.min(1, (local - i * every) / (every * 0.6)))
  const a = all[i], b = all[i + 1]
  const cur = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f }
  const s = Math.min(1 / cur.w, 1 / cur.h) * 0.82
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2
  const stop = stops[i]
  const settled = ramp(local, i * every + every * 0.6, 6)
  const box = { left: (stop.x - cx) * W * s + W / 2, top: (stop.y - cy) * H * s + H / 2, w: stop.w * W * s, h: stop.h * H * s }
  return (
    <div style={{ position: "relative", width: W, height: H, borderRadius: theme.radius * u, overflow: "hidden", background: theme.deep, boxShadow: `0 ${20 * u}px ${60 * u}px rgba(0,0,0,0.25)`, ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: `translate(${W / 2 - cx * W * s}px, ${H / 2 - cy * H * s}px) scale(${s})` }}>{picture(pic)}</div>
      {settled > 0 ? (
        <>
          <div style={{ position: "absolute", left: box.left, top: box.top, width: box.w, height: box.h, borderRadius: 14 * u, border: `${5 * u}px solid ${accent}`, boxShadow: `0 0 0 ${3000 * u}px rgba(0,0,0,${0.45 * settled})`, opacity: settled }} />
          {stop.label ? <div style={{ position: "absolute", left: Math.max(16 * u, Math.min(W - 16 * u, box.left)), top: Math.min(H - 90 * u, box.top + box.h + 18 * u), padding: `${10 * u}px ${20 * u}px`, borderRadius: 14 * u, background: accent, color: theme.accentForeground, fontFamily: font, fontWeight: 700, fontSize: 36 * u, opacity: settled, transform: `translateY(${(1 - settled) * 16 * u}px)`, whiteSpace: "nowrap" }}>{stop.label}</div> : null}
        </>
      ) : null}
    </div>
  )
}

// ---------- split screen ----------------------------------------------------------

/** Two pictures one above the other (a duet): the top grey and slow, the bottom crisp, with labels. */
export function SplitScreen({ top, bottom, topLabel, bottomLabel, width = 940, height = 1300, at = 0, style }: Base & { top: Pic; bottom: Pic; topLabel?: string; bottomLabel?: string; width?: number; height?: number }) {
  const t = useClock(at)
  const { u, fps, theme, accent, font } = useStage()
  const W = width * u, H = height * u, gap = 12 * u, h = (H - gap) / 2
  const a = spring({ frame: t, fps, config: { damping: 18, stiffness: 140 } })
  const b = spring({ frame: t - 8, fps, config: { damping: 14, stiffness: 160 } })
  const chip = (text: string, hot: boolean, p: number) => <div style={{ position: "absolute", left: 24 * u, top: 24 * u, padding: `${10 * u}px ${22 * u}px`, borderRadius: 999, background: hot ? accent : "rgba(10,10,12,0.65)", color: hot ? theme.accentForeground : "#F2F2F2", fontFamily: font, fontWeight: 800, fontSize: 36 * u, opacity: ramp(t, 10, 8), transform: `scale(${0.8 + 0.2 * Math.min(1, p)})` }}>{text}</div>
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: h, borderRadius: theme.radius * u, overflow: "hidden", transform: `translateX(${(1 - Math.min(1, a)) * -W}px)` }}>
        {picture(top, { filter: "grayscale(0.85) contrast(0.85) brightness(0.9)" })}
        {topLabel ? chip(topLabel, false, a) : null}
      </div>
      <div style={{ position: "absolute", left: 0, top: h + gap, width: W, height: h, borderRadius: theme.radius * u, overflow: "hidden", transform: `translateX(${(1 - Math.min(1, b)) * W}px)` }}>
        {picture(bottom, { filter: "saturate(1.15) contrast(1.05)" })}
        {bottomLabel ? chip(bottomLabel, true, b) : null}
      </div>
    </div>
  )
}

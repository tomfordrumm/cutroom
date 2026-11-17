// The move library: named, measured moves as pure functions of the frame.
// Pick a move by what it says (enter, carry, contact, camera), not by taste,
// and never re-derive a spring or an ease with ad-hoc constants.
//
//   import { moves, ease } from "cutroom"
//   const s = moves.rise(frame, { delay: 4 })          // → { opacity, transform }
//   <div style={moves.rise(frame)}>…</div>
//
// Every function takes frames of the overlay (useCurrentFrame()), returns plain
// numbers or a style object, and is deterministic: the render seeks frames in
// any order. `cutroom gfx moves` renders a sheet of every move.
import { Easing, interpolate, spring } from "remotion"

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const FPS = 30

/** Curves by intent. t80 — share of the move's time at which it is 80 % done. */
export const ease = {
  /** Snap: lands fast and settles (t80 ≈ .23). Arrivals, cuts on a beat. */
  snap: Easing.out(Easing.exp),
  /** Out: a firm deceleration (t80 ≈ .42). The default for entrances. */
  out: Easing.out(Easing.cubic),
  /** Glide: slow in, slow out (t80 ≈ .65). Camera moves and carries between beats. */
  glide: Easing.inOut(Easing.sin),
  /** Whip: accelerate and brake hard. A fast camera move to a new subject. */
  whip: Easing.inOut(Easing.exp),
  /** Back: overshoots a little and returns. Small objects that pop. */
  back: Easing.out(Easing.back(1.6)),
  /** In: leaves, accelerating. Exits. */
  in: Easing.in(Easing.cubic),
} as const

/** Spring presets for remotion's spring(). */
export const springs = {
  /** Calm, no overshoot: cards, panels. */
  soft: { damping: 200, stiffness: 120, mass: 1 },
  /** Quick with a hint of overshoot: buttons, labels, messages. */
  snappy: { damping: 18, stiffness: 180, mass: 0.7 },
  /** Visible bounce: stickers, icons landing. */
  bouncy: { damping: 11, stiffness: 160, mass: 0.8 },
  /** Heavy: big objects, a camera settling. */
  heavy: { damping: 26, stiffness: 90, mass: 1.4 },
} as const

type Opts = { delay?: number; duration?: number; fps?: number }
const progress = (frame: number, { delay = 0, duration = 12 }: Opts, curve: (t: number) => number = ease.out) =>
  interpolate(frame - delay, [0, Math.max(1, duration)], [0, 1], { ...clamp, easing: curve })

// ---------- enter: something arrives -----------------------------------------

/** Fade in while rising `distance` px (at 1080). The default entrance for text and cards. */
export function rise(frame: number, { delay = 0, duration = 12, distance = 36, u = 1 }: Opts & { distance?: number; u?: number } = {}) {
  const t = progress(frame, { delay, duration })
  return { opacity: t, transform: `translateY(${(1 - t) * distance * u}px)` }
}

/** Scale from small with a spring overshoot. Icons, stickers, a number landing. */
export function popIn(frame: number, { delay = 0, fps = FPS, from = 0.4 }: Opts & { from?: number } = {}) {
  const s = spring({ frame: frame - delay, fps, config: springs.bouncy })
  return { opacity: Math.min(1, s * 2), transform: `scale(${from + (1 - from) * s})` }
}

/** A line of text revealed from under an invisible edge: the mask rises. */
export function maskRise(frame: number, { delay = 0, duration = 14 }: Opts = {}) {
  const t = progress(frame, { delay, duration }, ease.snap)
  return { clipPath: `inset(${(1 - t) * 100}% 0 0 0)`, transform: `translateY(${(1 - t) * 40}%)` }
}

/** Words of a phrase rise one after another. Returns a style per word. */
export function wordRise(text: string, frame: number, { delay = 0, every = 3, duration = 10, u = 1 }: Opts & { every?: number; u?: number } = {}) {
  return String(text).split(/(\s+)/).filter((w) => w.trim()).map((word, i) => ({ word, style: rise(frame, { delay: delay + i * every, duration, distance: 28, u }) }))
}

/** Slide in from a side. `from`: "left" | "right" | "top" | "bottom". */
export function slideIn(frame: number, { delay = 0, duration = 14, from = "left", distance = 120, u = 1 }: Opts & { from?: "left" | "right" | "top" | "bottom"; distance?: number; u?: number } = {}) {
  const t = progress(frame, { delay, duration }, ease.snap)
  const d = (1 - t) * distance * u
  const [x, y] = from === "left" ? [-d, 0] : from === "right" ? [d, 0] : from === "top" ? [0, -d] : [0, d]
  return { opacity: Math.min(1, t * 1.6), transform: `translate(${x}px, ${y}px)` }
}

/** Leave: fade and drop for the last `duration` frames of `length`. Multiply opacity with the entrance. */
export function exit(frame: number, length: number, { duration = 7, distance = 18, u = 1 }: { duration?: number; distance?: number; u?: number } = {}) {
  const t = interpolate(frame, [length - duration, length], [0, 1], { ...clamp, easing: ease.in })
  return { opacity: 1 - t, transform: `translateY(${t * distance * u}px)` }
}

// ---------- text that happens ---------------------------------------------------

const graphemes = (text: string) => Array.from(new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(text), (p) => p.segment)

/**
 * Typing: the part of `text` typed by `frame`, from `start` to `end` frames.
 * Punctuation and spaces take longer than letters, so it reads as a hand.
 */
export function typeOn(text: string, frame: number, start: number, end: number) {
  if (frame <= start) return ""
  if (frame >= end || end <= start) return text
  const chars = graphemes(text)
  const weights = chars.map((c, i) => (/[,.!?;:]/u.test(c) ? 2.8 : /\s/u.test(c) ? 1.5 : 0.8 + ((i * 7) % 9) * 0.075))
  const budget = (weights.reduce((a, b) => a + b, 0) * (frame - start)) / (end - start)
  let used = 0, n = 0
  while (n < chars.length && used + weights[n] <= budget) used += weights[n++]
  return chars.slice(0, n).join("")
}

/** A caret that blinks about twice a second, solid while typing. */
export const caretOn = (frame: number, typing: boolean, fps = FPS) => typing || Math.floor((frame / fps) * 2.4) % 2 === 0

/** A number counting from `from` to `to` between frames `start` and `end`, easing out. */
export function countUp(frame: number, from: number, to: number, start: number, end: number, { decimals = 0 } = {}) {
  const t = interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...clamp, easing: ease.out })
  const value = from + (to - from) * t
  return Number(value.toFixed(decimals))
}

/** Width share (0–1) of a highlighter stroke sweeping over a word from `start`. */
export const sweep = (frame: number, start: number, duration = 10) => progress(frame, { delay: start, duration }, ease.snap)

// ---------- contact: one thing causes another ---------------------------------

/** A press at frame `at`: scale dips and springs back. Buttons, keys, cards under a cursor. */
export function press(frame: number, at: number, { depth = 0.08, fps = FPS } = {}) {
  if (frame < at) return 1
  const down = interpolate(frame - at, [0, 3], [0, 1], clamp)
  const back = spring({ frame: frame - at - 3, fps, config: springs.snappy })
  return 1 - depth * down * (1 - back)
}

/** A decaying shake starting at `at`, in px (at 1080). Errors, an impact landing. */
export function shake(frame: number, at: number, { amplitude = 14, duration = 12, u = 1 } = {}) {
  const t = frame - at
  if (t < 0 || t > duration) return 0
  return Math.sin(t * 2.4) * amplitude * u * (1 - t / duration)
}

/** Squash on landing at `at`: { scaleX, scaleY }, wider and flatter, then back. */
export function squash(frame: number, at: number, { amount = 0.18, fps = FPS } = {}) {
  if (frame < at) return { scaleX: 1, scaleY: 1 }
  const s = 1 - spring({ frame: frame - at, fps, config: springs.bouncy })
  const k = amount * Math.max(-0.4, s)
  return { scaleX: 1 + k, scaleY: 1 - k }
}

/** A point along a polyline at progress t (0–1). Cursor paths, a dot travelling. */
export function along(points: { x: number; y: number }[], t: number) {
  if (!points.length) return { x: 0, y: 0 }
  if (points.length === 1 || t <= 0) return points[0]
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  const total = lengths.reduce((a, b) => a + b, 0) || 1
  let left = Math.min(1, t) * total
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const k = lengths[i] ? left / lengths[i] : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k }
    }
    left -= lengths[i]
  }
  return points[points.length - 1]
}

/**
 * A cursor travelling through `stops` ({ x, y, at }: frame it arrives) and
 * clicking at the ones with `click: true`. Returns { x, y, press } for <Cursor>.
 */
export function cursorPath(frame: number, stops: { x: number; y: number; at: number; click?: boolean }[]) {
  if (!stops.length) return { x: 0, y: 0, press: 0 }
  let i = stops.findIndex((s) => s.at > frame)
  if (i === -1) i = stops.length
  const prev = stops[Math.max(0, i - 1)]
  const next = stops[Math.min(stops.length - 1, i)]
  const travel = Math.max(1, next.at - prev.at)
  const t = i === 0 || i === stops.length ? (i === 0 ? 0 : 1) : interpolate(frame, [prev.at, prev.at + travel], [0, 1], { ...clamp, easing: ease.glide })
  const x = prev.x + (next.x - prev.x) * t
  const y = prev.y + (next.y - prev.y) * t
  const clicking = stops.filter((s) => s.click).map((s) => frame - s.at).find((d) => d >= 0 && d < 8)
  return { x, y, press: clicking === undefined ? 0 : interpolate(clicking, [0, 2, 8], [0, 1, 0], clamp) }
}

// ---------- carry: the next beat grows out of this one -------------------------

export type Rect = { x: number; y: number; w: number; h: number; r?: number }

/**
 * A container that becomes the next scene: the rect of a card at frame `start`
 * grows (or shrinks) into `to` by `end`. Put the next scene's content inside it.
 */
export function morph(frame: number, from: Rect, to: Rect, start: number, end: number, curve = ease.glide): Rect {
  const t = interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...clamp, easing: curve })
  const mix = (a: number, b: number) => a + (b - a) * t
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), w: mix(from.w, to.w), h: mix(from.h, to.h), r: mix(from.r ?? 0, to.r ?? 0) }
}

/** Style for an absolutely positioned box from a Rect. */
export const rectStyle = (r: Rect): React.CSSProperties => ({ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r ?? 0 })

/**
 * Push the camera into `target` (a rect in frame pixels) until it fills the
 * frame: apply the returned transform to the whole stage (transformOrigin 0 0).
 * The card you push into becomes the next scene.
 */
export function zoomThrough(frame: number, target: Rect, size: { width: number; height: number }, start: number, end: number, curve = ease.whip) {
  const t = interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...clamp, easing: curve })
  const scale = Math.min(size.width / target.w, size.height / target.h)
  const s = 1 + (scale - 1) * t
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2
  // The target's centre travels to the frame's centre as the scale grows.
  const tx = (size.width / 2 - cx * s) * t
  const ty = (size.height / 2 - cy * s) * t
  return { transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: "0 0" }
}

/** A circular stage opening from a point (x, y): clip-path for the next scene. */
export function iris(frame: number, x: number, y: number, size: { width: number; height: number }, start: number, end: number, { reverse = false } = {}) {
  const t = interpolate(frame, [start, Math.max(start + 1, end)], reverse ? [1, 0] : [0, 1], { ...clamp, easing: ease.glide })
  const radius = Math.hypot(Math.max(x, size.width - x), Math.max(y, size.height - y)) * t
  return { clipPath: `circle(${radius}px at ${x}px ${y}px)` }
}

/** Items gathering from scattered spots into their places: style for item i of n. */
export function gather(frame: number, i: number, n: number, start: number, { duration = 18, spread = 260, u = 1 } = {}) {
  const t = interpolate(frame, [start + i * 2, start + i * 2 + duration], [0, 1], { ...clamp, easing: ease.snap })
  const angle = (i / Math.max(1, n)) * Math.PI * 2 + 0.7
  const d = (1 - t) * spread * u
  return { opacity: Math.min(1, t * 2), transform: `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d}px) scale(${0.7 + 0.3 * t})` }
}

// ---------- camera ----------------------------------------------------------------

export type CameraKey = { at: number; x?: number; y?: number; scale?: number; ease?: (t: number) => number }

/**
 * A keyed camera over a stage: { at, x, y, scale } keys in frames; (x, y) is the
 * stage point at the centre of the frame. Key the subject a few frames ahead
 * with ease.glide to follow it, key the landing before a snap with ease.whip.
 * Apply the returned style to the stage container (sized like the frame).
 */
export function camera(frame: number, keys: CameraKey[], size: { width: number; height: number }) {
  const sorted = [...keys].sort((a, b) => a.at - b.at)
  const value = (key: "x" | "y" | "scale", fallback: number) => {
    const list = sorted.filter((k) => k[key] !== undefined)
    if (!list.length) return fallback
    let i = list.findIndex((k) => k.at > frame)
    if (i === -1) return list[list.length - 1][key] as number
    if (i === 0) return list[0][key] as number
    const a = list[i - 1], b = list[i]
    return interpolate(frame, [a.at, b.at], [a[key] as number, b[key] as number], { ...clamp, easing: b.ease ?? ease.glide })
  }
  const s = value("scale", 1)
  const x = value("x", size.width / 2), y = value("y", size.height / 2)
  return { transform: `translate(${size.width / 2 - x * s}px, ${size.height / 2 - y * s}px) scale(${s})`, transformOrigin: "0 0" }
}

/** A slow hand-held float in px, for a camera in a long hold. Keep it tiny (≤ 6 px). */
export function drift(frame: number, { amplitude = 4, period = 90, u = 1 } = {}) {
  const k = (frame / period) * Math.PI * 2
  return { x: (Math.sin(k) + Math.sin(k * 0.37 + 1)) * 0.5 * amplitude * u, y: (Math.cos(k * 0.8) + Math.sin(k * 0.23)) * 0.5 * amplitude * u }
}

/** Frames between items of a sequence that must fit `count` items into `span` frames. */
export const stagger = (count: number, span: number, { min = 3, max = 18 } = {}) => Math.max(min, Math.min(max, Math.floor(span / Math.max(1, count))))

/** Every move by name, for the sheet and for `moves.<name>` in components. */
export const moves = { rise, popIn, maskRise, wordRise, slideIn, exit, typeOn, countUp, sweep, press, shake, squash, along, cursorPath, morph, zoomThrough, iris, gather, camera, drift, stagger }

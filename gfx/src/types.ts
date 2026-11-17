// Input of the Cutroom composition. The worker builds it from graphics.json
// (times in source seconds) and the version's timeline (program time).

export type Theme = {
  /** Highlights: active caption word, kicker, bullets, numbers. */
  accent: string
  /** Text drawn on the accent colour. */
  accentForeground: string
  /** A rare partner of the accent: a second state, the "after" of a comparison. */
  accent2: string
  /** Full-screen graphics background. */
  background: string
  /** A second ground: the far plane, a well under cards. */
  deep: string
  /** Text on the background. */
  foreground: string
  /** Secondary text and labels on the background. */
  mute: string
  /** Hairlines, card edges, dividers. */
  line: string
  /** Cards over the video (titles, lists). */
  card: string
  cardForeground: string
  /** Corner radius at 1080 px width. */
  radius: number
  /** Font families; a taste pack bundles its own fonts. */
  font: string
  displayFont: string
  captionFont: string
}

export const DEFAULT_THEME: Theme = {
  accent: "#22c55e",
  accentForeground: "#0a0a0a",
  accent2: "#60a5fa",
  background: "#0a0a0a",
  deep: "#050505",
  foreground: "#fafafa",
  mute: "#a1a1aa",
  line: "#27272a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  radius: 28,
  font: "Inter Variable",
  displayFont: "Inter Variable",
  captionFont: "Inter Variable",
}

export type CaptionsSettings = {
  style: "pill" | "plain" | "off"
  /** bottom: above the platform's bottom safe zone; auto: just under the face; center. */
  position: "bottom" | "center" | "auto"
  wordsPerPage: number
  uppercase: boolean
}

export type Word = { start: number; end: number; text: string }

export type PlacedOverlay = {
  id: string
  type: string
  /** For type "custom": file name in custom/ without .tsx. */
  component?: string
  /** Program frames. */
  from: number
  to: number
  props: Record<string, unknown>
}

/** Presenter's face at program second t: [x, y, w, h] as 0–1 of the frame, null when not found. */
export type FaceSample = { t: number; box: [number, number, number, number] | null; count?: number }

/** Review renders: draw only one layer on a transparent frame, to measure it. */
export type Isolate = { layer: "overlay"; id: string } | { layer: "captions" }

/** Music bed or sound effect on program frames. Volumes are linear, 0–1. */
export type AudioTrack = {
  id: string
  type: "music" | "sfx"
  src: string
  from: number
  to: number
  volume: number
  /** Music only: level between phrases (the bed rises when nobody speaks). */
  pauseVolume?: number
  fadeIn?: number
  fadeOut?: number
  /** Seconds into the file where playback starts. */
  offset?: number
  loop?: boolean
}

export type MainProps = {
  videoUrl: string | null
  width: number
  height: number
  fps: number
  durationInFrames: number
  theme: Theme
  captions: CaptionsSettings | null
  words: Word[]
  overlays: PlacedOverlay[]
  faces: FaceSample[]
  audio?: AudioTrack[]
  isolate?: Isolate | null
}

/** Pixel rectangle in composition coordinates. */
export type Box = { x: number; y: number; w: number; h: number }

/** What every overlay component receives. `u` is one pixel at 1080 px of the short side. */
export type OverlayProps<P = Record<string, unknown>> = {
  props: P
  theme: Theme
  u: number
  width: number
  height: number
}

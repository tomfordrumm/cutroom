// Shared by the library scenes: the theme as colours and fonts, the pixel unit
// and the element's clock. Adapted from remocn (MIT, see LICENSE-remocn.md).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { useTheme } from "../kit"
import { useLayout } from "../layout"

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/** `hex` at `percent` % over transparent. */
export const tint = (hex: string, percent: number) => `color-mix(in srgb, ${hex} ${percent}%, transparent)`
/** `hex` mixed with `other` (`percent` % of hex). */
export const mix = (hex: string, other: string, percent: number) => `color-mix(in srgb, ${hex} ${percent}%, ${other})`

/** Theme, pixel unit and frame size for a library scene. */
export function useStage() {
  const theme = useTheme()
  const { fps, width, height } = useVideoConfig()
  let u = Math.min(width, height) / 1080
  try { u = useLayout().u } catch { /* outside a Cutroom composition: the frame's short side */ }
  return {
    theme, u, fps, width, height,
    ink: theme.foreground,
    mute: theme.mute,
    line: theme.line,
    accent: theme.accent,
    accent2: theme.accent2,
    font: `"${theme.font}", system-ui, sans-serif`,
    display: `"${theme.displayFont}", "${theme.font}", sans-serif`,
  }
}

/** Frames since `at` (the element's frame the scene starts on), times `speed`. */
export function useClock(at = 0, speed = 1) {
  return Math.max(0, useCurrentFrame() - at) * speed
}

/** 0→1 over `len` frames from `from`. */
export const ramp = (t: number, from: number, len: number) => interpolate(t, [from, from + Math.max(1, len)], [0, 1], CLAMP)

/** A short hit: up in one frame, eases back over `len`. */
export function kick(d: number, len: number) {
  if (d < 0 || d > len + 1) return 0
  if (d < 1) return d
  const k = 1 - (d - 1) / len
  return k * k
}

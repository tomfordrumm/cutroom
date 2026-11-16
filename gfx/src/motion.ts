import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * Enter with a soft spring, leave with a short fade. Call inside a Sequence:
 * frame and duration are the overlay's own.
 */
export function useEnterExit(delay = 0) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const enter = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 180, mass: 0.7 } })
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) })
  return { enter, opacity: Math.min(interpolate(enter, [0, 0.6], [0, 1], clamp), exit) }
}

/** Seconds a viewer needs to read a text: about 3 words a second plus a second to notice it. */
export function readingSeconds(text: string) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length
  return 1 + words / 3
}

export { clamp }

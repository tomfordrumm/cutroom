// Transitions between two scenes of one component: styles for the outgoing and
// the incoming scene. Adapted from remocn transitions (MIT, see LICENSE-remocn.md).
import type { CSSProperties } from "react"
import { Easing, interpolate } from "remotion"
import { CLAMP } from "./common"

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

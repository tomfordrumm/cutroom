// A hand-drawn brush arrow that sweeps from one point to another in stop-motion
// poses, its head popping on the last ones. Points are in frame pixels.
// Adapted from remocn ink-arrow (MIT, see LICENSE-remocn.md).
import React from "react"
import { useCurrentFrame } from "remotion"
import { BrushGrain, type BrushPoint, brushFilterId, brushRibbon, sampleCubic, sampleLine } from "./brush"
import { useStage } from "./common"
import { DEFAULT_STEP, hashRange, steppedRamp } from "./stop-motion"

const HEAD_ANGLE = 0.72
const SHAFT_SAMPLES = 40
const ARM_SAMPLES = 10
const ARM_TAPER = 0.6
const ARM_OVERSHOOT = 0.16
const HEAD_MIN_RATIO = 2.6

function controls(from: BrushPoint, to: BrushPoint, curvature: number, seed: string) {
  const dx = to.x - from.x, dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1
  const nx = -dy / distance, ny = dx / distance
  const bow = curvature * distance, wobble = distance * 0.06
  const point = (t: number, key: string) => ({
    x: from.x + dx * t + nx * bow + hashRange(`${seed}:${key}:x`, -wobble, wobble),
    y: from.y + dy * t + ny * bow + hashRange(`${seed}:${key}:y`, -wobble, wobble),
  })
  return { c1: point(0.3, "c1"), c2: point(0.7, "c2") }
}

function head(c2: BrushPoint, to: BrushPoint, size: number) {
  const dx = to.x - c2.x, dy = to.y - c2.y
  const length = Math.hypot(dx, dy) || 1
  const bx = -dx / length, by = -dy / length
  const arm = (a: number) => ({ x: to.x + size * (bx * Math.cos(a) - by * Math.sin(a)), y: to.y + size * (bx * Math.sin(a) + by * Math.cos(a)) })
  return { left: arm(HEAD_ANGLE), right: arm(-HEAD_ANGLE), apex: { x: to.x + (dx / length) * size * ARM_OVERSHOOT, y: to.y + (dy / length) * size * ARM_OVERSHOOT } }
}

export type InkArrowProps = {
  /** Tail, in frame pixels. */
  from: BrushPoint
  /** Tip, in frame pixels. */
  to: BrushPoint
  /** Bow of the shaft: 0 straight, ± bends to either side. */
  curvature?: number
  color?: string
  /** Shaft width, px at 1080. */
  strokeWidth?: number
  /** Head size, px at 1080. */
  headSize?: number
  /** Element frame the stroke starts. */
  at?: number
  /** Frames to draw the shaft. */
  draw?: number
  /** 0 smooth – 1 dry brush. */
  grain?: number
  /** Another seed gives another hand-drawn wobble. */
  seed?: string
  /** Frames per stop-motion pose. */
  step?: number
}

/** Covers the whole frame: put it last in the scene, at the top level. */
export function InkArrow({ from, to, curvature = 0.3, color, strokeWidth = 16, headSize = 46, at = 0, draw = 18, grain = 1, seed = "arrow", step = DEFAULT_STEP }: InkArrowProps) {
  const frame = useCurrentFrame()
  const { u, width, height, accent } = useStage()
  const sw = strokeWidth * u
  const progress = steppedRamp(frame, at, at + draw, { step })
  const { c1, c2 } = controls(from, to, curvature, seed)
  const h = head(c2, to, Math.max(headSize * u, sw * HEAD_MIN_RATIO))
  const headStart = at + draw, headFrames = step * 4
  const leftArm = steppedRamp(frame, headStart, headStart + headFrames / 2, { step })
  const rightArm = steppedRamp(frame, headStart + headFrames / 2, headStart + headFrames, { step })
  const filter = grain > 0 ? `url(#${brushFilterId(seed, sw, grain)})` : undefined
  const fill = color ?? accent
  const arm = (tip: BrushPoint, p: number) => brushRibbon(sampleLine(h.apex, tip, ARM_SAMPLES), { strokeWidth: sw, pressure: 1, release: ARM_TAPER, progress: p })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: progress > 0 ? 1 : 0, pointerEvents: "none" }} aria-hidden>
      <BrushGrain seed={seed} strokeWidth={sw} grain={grain} />
      <path d={brushRibbon(sampleCubic(from, c1, c2, to, SHAFT_SAMPLES), { strokeWidth: sw, pressure: 0.2, release: 1, progress })} fill={fill} opacity={0.92} filter={filter} />
      {leftArm > 0 ? <path d={arm(h.left, leftArm)} fill={fill} opacity={0.92} filter={filter} /> : null}
      {rightArm > 0 ? <path d={arm(h.right, rightArm)} fill={fill} opacity={0.92} filter={filter} /> : null}
    </svg>
  )
}

// Core layout mechanics, the same for every taste pack: platform safe zones,
// the presenter's face over time (with punch-in zoom applied), the captions
// area, and free zones where a graphic can sit without covering the face.
import { createContext, useContext } from "react"
import type { Box, FaceSample } from "./types"

export type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * Areas the platform UI covers. Portrait follows Shorts/Reels/TikTok
 * (250 / 380 px top / bottom and 120 px sides at 1080×1920); landscape
 * keeps a 5% title-safe margin.
 */
export function safeArea(width: number, height: number): Insets {
  if (height > width * 1.2) return { top: height * 0.13, bottom: height * 0.198, left: width * 0.111, right: width * 0.111 }
  if (width > height * 1.2) return { top: height * 0.05, bottom: height * 0.05, left: width * 0.05, right: width * 0.05 }
  return { top: height * 0.06, bottom: height * 0.06, left: width * 0.06, right: width * 0.06 }
}

export type Zoom = { scale: number; originX: number; originY: number }

export type Layout = {
  width: number
  height: number
  fps: number
  u: number
  safe: Insets
  /** Where captions are drawn, or null when there are none. */
  captions: Box | null
  faces: FaceSample[]
  zoomAt: (frame: number) => Zoom
}

export const LayoutContext = createContext<Layout | null>(null)
/** The overlay being drawn: its first and last program frame. */
export const OverlayContext = createContext<{ id: string; from: number; to: number } | null>(null)

const NO_ZOOM: Zoom = { scale: 1, originX: 0.5, originY: 0.5 }

function toPixels(box: [number, number, number, number], layout: Layout, zoom: Zoom): Box {
  const { width, height } = layout
  const ox = zoom.originX * width, oy = zoom.originY * height
  const x = ox + (box[0] * width - ox) * zoom.scale
  const y = oy + (box[1] * height - oy) * zoom.scale
  return { x, y, w: box[2] * width * zoom.scale, h: box[3] * height * zoom.scale }
}

/** Index of the last sample at or before t. */
function sampleIndex(faces: FaceSample[], t: number) {
  let lo = 0, hi = faces.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (faces[mid].t <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

/** Face box at a program frame, interpolated between samples; null when none is near. */
export function faceAt(layout: Layout, frame: number): Box | null {
  const { faces, fps } = layout
  if (!faces.length) return null
  const t = frame / fps
  const i = sampleIndex(faces, t)
  const a = faces[i], b = faces[i + 1]
  let box: [number, number, number, number] | null = null
  if (a?.box && b?.box && b.t - a.t < 0.6) {
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t)
    box = a.box.map((v, n) => v + (b.box![n] - v) * k) as [number, number, number, number]
  } else {
    const near = [a, b].filter((s) => s && s.box && Math.abs(s.t - t) < 0.4).sort((p, q) => Math.abs(p!.t - t) - Math.abs(q!.t - t))[0]
    box = near?.box ?? null
  }
  return box ? toPixels(box, layout, layout.zoomAt(frame)) : null
}

/** Union of the face over a frame range (conservative: covers every sampled position). */
export function faceUnion(layout: Layout, from: number, to: number): Box | null {
  const { faces, fps } = layout
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const consider = (box: Box | null) => {
    if (!box) return
    x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y); x1 = Math.max(x1, box.x + box.w); y1 = Math.max(y1, box.y + box.h)
  }
  for (const sample of faces) {
    if (sample.t < from / fps - 0.25 || sample.t > to / fps + 0.25 || !sample.box) continue
    consider(toPixels(sample.box, layout, layout.zoomAt(Math.round(sample.t * fps))))
  }
  consider(faceAt(layout, from))
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export type Zone = { top: number; bottom: number }
export type Placement = "auto" | "top" | "center" | "bottom" | "above-face" | "below-face"

/**
 * Vertical band for a graphic over [from, to]: between the top safe line and
 * the face ("above-face"), or between the face and the captions ("below-face").
 * "auto" takes the larger of the two.
 */
export function zoneFor(layout: Layout, placement: Placement, from: number, to: number): Zone {
  const { safe, height, u } = layout
  const gap = 28 * u
  const floor = (layout.captions ? layout.captions.y : height - safe.bottom) - gap
  const ceiling = safe.top
  if (placement === "top") return { top: ceiling, bottom: Math.min(floor, height * 0.45) }
  if (placement === "bottom") return { top: Math.max(ceiling, height * 0.5), bottom: floor }
  if (placement === "center") return { top: height * 0.3, bottom: height * 0.7 }
  const face = faceUnion(layout, from, to)
  if (!face) return placement === "below-face" ? { top: Math.max(ceiling, height * 0.5), bottom: floor } : { top: ceiling, bottom: Math.min(floor, height * 0.45) }
  const above = { top: ceiling, bottom: Math.max(ceiling, face.y - gap) }
  const below = { top: Math.min(floor, face.y + face.h + gap), bottom: floor }
  if (placement === "above-face") return above
  if (placement === "below-face") return below
  return below.bottom - below.top >= above.bottom - above.top ? below : above
}

export function useLayout(): Layout {
  const layout = useContext(LayoutContext)
  if (!layout) throw new Error("useLayout вне композиции Cutroom")
  return layout
}

export function useOverlay() {
  return useContext(OverlayContext)
}

/**
 * CSS for a block placed in its zone: centred in the band, or pinned to its
 * edge for "top"/"bottom". Use inside an overlay component.
 */
export function useZoneStyle(position: unknown): React.CSSProperties {
  const layout = useLayout()
  const overlay = useOverlay()
  const placement = (["auto", "top", "center", "bottom", "above-face", "below-face"].includes(String(position)) ? position : "auto") as Placement
  const zone = zoneFor(layout, placement, overlay?.from ?? 0, overlay?.to ?? 0)
  const base: React.CSSProperties = { position: "absolute", left: layout.safe.left, right: layout.safe.right, display: "flex", justifyContent: "center" }
  if (placement === "top") return { ...base, top: zone.top }
  if (placement === "bottom") return { ...base, bottom: layout.height - zone.bottom }
  return { ...base, top: (zone.top + zone.bottom) / 2, transform: "translateY(-50%)" }
}

export { NO_ZOOM }

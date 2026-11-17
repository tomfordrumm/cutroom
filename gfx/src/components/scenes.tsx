// Built-in scene elements on the interface kit: a ready picture from the
// pack ("sticker") and a chat with a typed question and an answer ("chat").
import React from "react"
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { ChatWindow, chatAt, Illustration, type ChatScriptLine, type Tone } from "../kit"
import { useLayout, useOverlay, useZoneStyle, zoneFor, type Placement } from "../layout"
import { clamp } from "../motion"
import { ease, exit, popIn, rise } from "../moves"
import { ILLUSTRATIONS } from "../pack"
import type { OverlayProps } from "../types"

const PLACEMENTS = ["auto", "top", "center", "bottom", "above-face", "below-face"]
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback)

/**
 * A ready picture from the pack: props.id (illustrations.md), size (px of the
 * longer side at 1080, 160–900), position (zone) or x, y (0–1 centre),
 * caption, motion: pop | rise | none.
 */
export function Sticker({ props, theme, u }: OverlayProps) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const layout = useLayout()
  const overlay = useOverlay()
  const id = String(props.id ?? "")
  // A pack illustration by id, or a picture generated for this video (props.src, square box).
  const generated = !ILLUSTRATIONS[id] && typeof props.src === "string" && props.src ? { src: props.src, width: 1, height: 1 } : null
  const item = ILLUSTRATIONS[id] ?? generated
  const placement = (PLACEMENTS.includes(String(props.position)) ? props.position : "auto") as Placement
  const zone = zoneFor(layout, placement, overlay?.from ?? 0, overlay?.to ?? 0)
  const caption = typeof props.caption === "string" ? props.caption : ""
  const room = zone.bottom - zone.top - (caption ? 90 * u : 0)
  // A big face leaves no band above or below it: then the picture sits at the side, on the shoulder line.
  const MIN = 300
  const cramped = room < MIN * u
  const size = cramped ? Math.max(MIN, Math.min(num(props.size, 380), 460)) : Math.min(Math.max(160, Math.min(900, num(props.size, 380))) * u, room) / u
  const motion = props.motion === "rise" ? rise(frame, { u }) : props.motion === "none" ? { opacity: 1, transform: "none" } : popIn(frame, { fps })
  const out = exit(frame, durationInFrames, { u })
  const free = typeof props.x === "number" && typeof props.y === "number"
  const k = item ? (size * u) / Math.max(item.width, item.height) : 0
  const box = item ? { w: item.width * k, h: item.height * k } : { w: 0, h: 0 }
  const floor = (layout.captions ? layout.captions.y : layout.height - layout.safe.bottom) - 24 * u
  const left = props.side === "left"
  const position: React.CSSProperties = free
    ? { position: "absolute", left: num(props.x, 0.5) * layout.width - box.w / 2, top: num(props.y, 0.5) * layout.height - box.h / 2 }
    : cramped
      ? { position: "absolute", [left ? "left" : "right"]: layout.safe.left, top: floor - box.h - (caption ? 90 * u : 0), display: "flex", flexDirection: "column", alignItems: "center" }
      : { position: "absolute", left: 0, right: 0, top: (zone.top + zone.bottom) / 2, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }
  return (
    <div style={{ ...position, opacity: Math.min(motion.opacity, out.opacity) }}>
      <div style={{ transform: `${motion.transform} ${out.transform}` }}>
        {generated ? <Img src={generated.src} style={{ width: box.w, height: box.h, objectFit: "contain", display: "block" }} /> : <Illustration id={id} size={size} />}
      </div>
      {caption && <div style={{ marginTop: 18 * u, padding: `${10 * u}px ${22 * u}px`, borderRadius: 999, background: theme.card, color: theme.cardForeground, fontFamily: `"${theme.displayFont}", sans-serif`, fontSize: 36 * u, fontWeight: 800, textAlign: "center" }}>{caption}</div>}
    </div>
  )
}

type ChatProps = { app?: string; messages?: (ChatScriptLine & { frames?: { at?: number; typeFrom?: number; typeTo?: number } })[]; tone?: Tone; fullFrame?: boolean; position?: string; width?: number; height?: number; fontSize?: number; placeholder?: string }

/**
 * A chat: props.app, messages [{ role, text, type: [start, end] | at }] (source
 * seconds, turned into frames by the core), tone, fullFrame or position, width,
 * height, fontSize (px at 1080).
 */
export function Chat({ props, theme, u, width, height }: OverlayProps) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const p = props as ChatProps
  const layout = useLayout()
  const zone = useZoneStyle(p.position ?? "auto")
  const script: ChatScriptLine[] = (p.messages ?? []).map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: String(m.text ?? ""), at: m.frames?.at, typeFrom: m.frames?.typeFrom, typeTo: m.frames?.typeTo }))
  const state = chatAt(script, frame, { fps })
  const enter = rise(frame, { u, distance: 60 })
  const out = exit(frame, durationInFrames, { u })
  const full = p.fullFrame === true
  const safeW = width - layout.safe.left - layout.safe.right
  // Full frame: between the top safe line and the captions, so they never cover the input field.
  const bottom = layout.captions ? layout.captions.y - 32 * u : height - layout.safe.bottom
  const w = Math.min(num(p.width, full ? 880 : 860), safeW / u)
  const h = Math.min(num(p.height, full ? 960 : 720), (full ? bottom - layout.safe.top : height * 0.5) / u)
  const view = <ChatWindow app={String(p.app ?? "Чат")} state={state} width={w} height={h} fontSize={num(p.fontSize, 42)} tone={p.tone ?? "auto"} placeholder={p.placeholder} />
  const bg = interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], { ...clamp, easing: ease.out })
  if (full) {
    return (
      <AbsoluteFill style={{ background: theme.background, opacity: bg, alignItems: "center", justifyContent: "center", paddingTop: layout.safe.top, paddingBottom: height - bottom, boxSizing: "border-box" }}>
        <div style={{ opacity: Math.min(enter.opacity, out.opacity), transform: `${enter.transform} ${out.transform}` }}>{view}</div>
      </AbsoluteFill>
    )
  }
  return (
    <div style={zone}>
      <div style={{ opacity: Math.min(enter.opacity, out.opacity), transform: `${enter.transform} ${out.transform}` }}>{view}</div>
    </div>
  )
}

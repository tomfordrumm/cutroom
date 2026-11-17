// Built-in overlays. Each is drawn inside a Sequence that spans the overlay,
// sized to the composition; `u` scales design pixels from a 1080 px short side.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { useLayout, useZoneStyle } from "../layout"
import { clamp, useEnterExit } from "../motion"
import type { OverlayProps } from "../types"
import { Action } from "./Action"
import { Clip, Picture } from "./media"
import { Chat, Sticker } from "./scenes"

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback)

/** A block in its zone: "auto" (default) keeps it off the face and above the captions. */
function Positioned({ position, children }: { position: unknown; children: React.ReactNode }) {
  return <div style={useZoneStyle(position)}>{children}</div>
}

/** Hook or heading in a card over the video. props: text, position, size (m|l). */
export function Title({ props, theme, u }: OverlayProps) {
  const { enter, opacity } = useEnterExit()
  const big = props.size !== "m"
  return (
    <Positioned position={props.position}>
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - enter) * 30 * u}px) scale(${0.95 + 0.05 * enter})`,
          maxWidth: "100%",
          fontFamily: theme.displayFont,
          padding: `${26 * u}px ${40 * u}px`,
          borderRadius: theme.radius * u,
          background: theme.card,
          color: theme.cardForeground,
          fontSize: (big ? 66 : 52) * u,
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          textAlign: "center",
          boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.25)`,
          textWrap: "balance",
        }}
      >
        {str(props.text)}
      </div>
    </Positioned>
  )
}

/** Full-frame graphic over the voice. props: kicker, title, body, align (left|center). */
export function FullScreen({ props, theme, u }: OverlayProps) {
  const { safe } = useLayout()
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const bg = Math.min(interpolate(frame, [0, 6], [0, 1], clamp), interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp))
  // Hooks first, unconditionally: kicker, title and body enter one after another.
  const enters = [useEnterExit(2).enter, useEnterExit(5).enter, useEnterExit(10).enter]
  const line = (index: number) => ({ opacity: enters[index], transform: `translateY(${(1 - enters[index]) * 40 * u}px)` })
  const center = props.align === "center"
  return (
    <AbsoluteFill style={{ opacity: bg, background: theme.background, color: theme.foreground, paddingTop: Math.max(96 * u, safe.top), paddingBottom: Math.max(96 * u, safe.bottom), paddingLeft: Math.max(96 * u, safe.left), paddingRight: Math.max(96 * u, safe.right), justifyContent: "center", alignItems: center ? "center" : "flex-start", textAlign: center ? "center" : "left" }}>
      {str(props.kicker) && (
        <div style={{ ...line(0), color: theme.accent, fontSize: 34 * u, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 28 * u }}>{str(props.kicker)}</div>
      )}
      <div style={{ ...line(1), fontFamily: theme.displayFont, fontSize: 92 * u, fontWeight: 800, lineHeight: 1.04, letterSpacing: "-0.03em", textWrap: "balance" }}>{str(props.title)}</div>
      {str(props.body) && (
        <div style={{ ...line(2), opacity: enters[2] * 0.72, marginTop: 36 * u, fontSize: 44 * u, lineHeight: 1.3, textWrap: "pretty" }}>{str(props.body)}</div>
      )}
    </AbsoluteFill>
  )
}

/** Points that appear one by one. props: title, items[], position, numbered. */
export function List({ props, theme, u }: OverlayProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const items = Array.isArray(props.items) ? props.items.map((i) => String(i)) : []
  const { enter, opacity } = useEnterExit()
  const stagger = Math.max(4, Math.min(18, Math.floor((durationInFrames * 0.6) / Math.max(items.length, 1))))
  return (
    <Positioned position={props.position}>
      <div
        style={{
          opacity,
          transform: `scale(${0.96 + 0.04 * enter})`,
          width: "100%",
          padding: 44 * u,
          borderRadius: theme.radius * u,
          background: theme.card,
          color: theme.cardForeground,
          boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.25)`,
        }}
      >
        {str(props.title) && <div style={{ fontFamily: theme.displayFont, fontSize: 50 * u, fontWeight: 800, lineHeight: 1.1, marginBottom: 26 * u, letterSpacing: "-0.02em" }}>{str(props.title)}</div>}
        {items.map((item, i) => {
          const t = interpolate(frame, [8 + i * stagger, 8 + i * stagger + 8], [0, 1], clamp)
          return (
            <div key={i} style={{ display: "flex", gap: 20 * u, alignItems: "baseline", fontSize: 42 * u, lineHeight: 1.25, marginTop: i ? 18 * u : 0, opacity: t, transform: `translateX(${(1 - t) * 24 * u}px)` }}>
              <span style={{ flex: "none", minWidth: 44 * u, height: 44 * u, borderRadius: 999, background: theme.accent, color: theme.accentForeground, fontSize: 26 * u, fontWeight: 800, display: "grid", placeItems: "center" }}>
                {props.numbered === false ? "•" : i + 1}
              </span>
              <span style={{ fontWeight: 600 }}>{item}</span>
            </div>
          )
        })}
      </div>
    </Positioned>
  )
}

/** A big number or short fact. props: value, label, position. */
export function Stat({ props, theme, u }: OverlayProps) {
  const { enter, opacity } = useEnterExit()
  return (
    <Positioned position={props.position}>
      <div style={{ opacity, transform: `scale(${0.85 + 0.15 * enter})`, padding: `${34 * u}px ${54 * u}px`, borderRadius: theme.radius * u, background: theme.card, color: theme.cardForeground, textAlign: "center", boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.25)` }}>
        <div style={{ fontFamily: theme.displayFont, fontSize: 150 * u, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em", color: theme.accent }}>{str(props.value)}</div>
        {str(props.label) && <div style={{ marginTop: 14 * u, fontSize: 40 * u, fontWeight: 600, maxWidth: 760 * u }}>{str(props.label)}</div>}
      </div>
    </Positioned>
  )
}

/** Name plate. props: title, subtitle. */
export function LowerThird({ props, theme, u }: OverlayProps) {
  const { enter, opacity } = useEnterExit()
  return (
    <div style={{ ...useZoneStyle("below-face"), justifyContent: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 * u, opacity, transform: `translateX(${(1 - enter) * -60 * u}px)` }}>
        <div style={{ padding: `${16 * u}px ${28 * u}px`, borderRadius: theme.radius * 0.6 * u, background: theme.card, color: theme.cardForeground, fontFamily: theme.displayFont, fontSize: 44 * u, fontWeight: 800 }}>{str(props.title)}</div>
        {str(props.subtitle) && (
          <div style={{ padding: `${10 * u}px ${22 * u}px`, borderRadius: theme.radius * 0.5 * u, background: theme.accent, color: theme.accentForeground, fontSize: 30 * u, fontWeight: 700 }}>{str(props.subtitle)}</div>
        )}
      </div>
    </div>
  )
}

/** Short accent label at a point of the frame. props: text, x, y (0..1). */
export function Callout({ props, theme, u, width, height }: OverlayProps) {
  const { enter, opacity } = useEnterExit()
  const x = typeof props.x === "number" ? props.x : 0.5
  const y = typeof props.y === "number" ? props.y : 0.3
  return (
    <div style={{ position: "absolute", left: x * width, top: y * height, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * enter}) rotate(${(1 - enter) * -6}deg)`, opacity }}>
      <div style={{ padding: `${16 * u}px ${30 * u}px`, borderRadius: 999, background: theme.accent, color: theme.accentForeground, fontSize: 46 * u, fontWeight: 800, whiteSpace: "nowrap", boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.3)` }}>
        {str(props.text)}
      </div>
    </div>
  )
}

export const BUILTIN: Record<string, React.ComponentType<OverlayProps>> = {
  title: Title,
  fullscreen: FullScreen,
  list: List,
  stat: Stat,
  lowerThird: LowerThird,
  callout: Callout,
  action: Action,
  image: Picture,
  video: Clip,
  sticker: Sticker,
  chat: Chat,
}

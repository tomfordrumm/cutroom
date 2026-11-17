// Author's materials in the frame: a picture or a video clip, full frame or as
// a card in a zone. The worker puts the file's URL into props.src.
import { AbsoluteFill, Img, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import { useLayout, useZoneStyle } from "../layout"
import { clamp, useEnterExit } from "../motion"
import type { OverlayProps } from "../types"

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback)

type MediaProps = { kind: "image" | "video" } & OverlayProps

function Media({ kind, props, theme, u, width }: MediaProps) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const layout = useLayout()
  const src = String(props.src ?? "")
  const full = (props.position ?? "full") === "full"
  const fit = props.fit === "contain" ? "contain" : "cover"
  const zone = useZoneStyle(full ? "auto" : props.position)
  const { enter, opacity } = useEnterExit()
  const transparent = props.transparent === true
  const element = kind === "image"
    ? <Img src={src} style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }} />
    : (
      <OffthreadVideo
        src={src}
        trimBefore={Math.round(num(props.from, 0) * fps)}
        volume={Math.min(1, Math.max(0, num(props.volume, 0)))}
        muted={num(props.volume, 0) <= 0}
        transparent={transparent}
        style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
      />
    )

  if (full) {
    // Short crossfade in and out; a slow push-in keeps a still picture alive.
    const fade = Math.min(interpolate(frame, [0, 6], [0, 1], clamp), interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp))
    const push = kind === "image" && props.motion !== "none" ? interpolate(frame, [0, durationInFrames], [1, 1.06], clamp) : 1
    return (
      <AbsoluteFill style={{ background: transparent ? "transparent" : fit === "contain" ? theme.background : "#000", opacity: transparent ? 1 : fade }}>
        <AbsoluteFill style={{ transform: `scale(${push})` }}>{element}</AbsoluteFill>
      </AbsoluteFill>
    )
  }

  const safeWidth = width - layout.safe.left - layout.safe.right
  const boxWidth = safeWidth * Math.min(1, Math.max(0.3, num(props.size, 0.8)))
  const aspect = num(props.aspect, kind === "image" ? 0 : 16 / 9)
  return (
    <div style={zone}>
      <div
        style={{
          width: boxWidth,
          ...(aspect > 0 ? { height: boxWidth / aspect } : {}),
          borderRadius: theme.radius * u,
          overflow: "hidden",
          boxShadow: `0 ${18 * u}px ${48 * u}px rgba(0,0,0,0.35)`,
          opacity,
          transform: `scale(${interpolate(enter, [0, 1], [0.92, 1])})`,
          background: theme.card,
        }}
      >
        {kind === "image" && aspect <= 0
          ? <Img src={src} style={{ width: "100%", display: "block" }} />
          : element}
      </div>
    </div>
  )
}

/** Picture. props: file, position (full | zone), fit (cover | contain), size 0.3–1, aspect, motion: "none". */
export const Picture = (p: OverlayProps) => <Media kind="image" {...p} />
/** Video clip (b-roll). props: file, from (seconds into the clip), volume 0–1 (muted by default), position, fit, size, aspect. */
export const Clip = (p: OverlayProps) => <Media kind="video" {...p} />

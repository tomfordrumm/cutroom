// One key word or short phrase, punched in large over the video in the free
// zone next to the face. props: text, position (auto | above-face | below-face | top | bottom | center), tone (accent | light)
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { clamp, useLayout, useZoneStyle, type OverlayProps } from "cutroom"

export default function KeyWord({ props, theme, u }: OverlayProps) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const zone = useZoneStyle(props.position ?? "auto")
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } })
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp)
  const layout = useLayout()
  const text = String(props.text ?? "")
  // Uppercase Montserrat Black with its stroke is about 1 em per letter: fit the longest word into the safe width.
  const longest = Math.max(1, ...text.split(/\s+/).map((word) => word.length))
  const safeWidth = (layout.width - layout.safe.left - layout.safe.right) / u
  const size = Math.min(150, safeWidth / longest)
  return (
    <div style={zone}>
      <div
        style={{
          opacity: Math.min(interpolate(pop, [0, 0.4], [0, 1], clamp), out),
          transform: `scale(${0.6 + 0.4 * pop}) rotate(${(1 - pop) * -4}deg)`,
          fontFamily: theme.displayFont,
          fontWeight: 900,
          fontSize: size * u,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          textAlign: "center",
          textTransform: "uppercase",
          color: props.tone === "light" ? "#ffffff" : theme.accent,
          WebkitTextStroke: `${10 * u}px rgba(0,0,0,0.9)`,
          paintOrder: "stroke fill",
          textShadow: `0 ${6 * u}px ${24 * u}px rgba(0,0,0,0.5)`,
          textWrap: "balance",
        }}
      >
        {text}
      </div>
    </div>
  )
}

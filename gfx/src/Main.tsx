import { useEffect, useMemo, useState } from "react"
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, OffthreadVideo, Sequence, useCurrentFrame } from "remotion"
import { AudioTracks } from "./components/AudioTracks"
import { BUILTIN } from "./components/builtin"
import { Captions } from "./components/Captions"
import { LayoutContext, OverlayContext, safeArea, type Layout, type Zoom } from "./layout"
import { clamp } from "./motion"
import { PACK, PACK_CAPTIONS, PACK_COMPONENTS } from "./pack"
import { DEFAULT_THEME, type Box, type CaptionsSettings, type MainProps, type OverlayProps, type PlacedOverlay } from "./types"

// Agent-written components: custom/<Name>.tsx with a default export.
declare const require: { context: (dir: string, deep: boolean, pattern: RegExp) => { keys: () => string[]; (key: string): { default: React.ComponentType<OverlayProps> } } }
const customContext = require.context("./custom", false, /\.tsx$/)
const CUSTOM: Record<string, React.ComponentType<OverlayProps>> = Object.fromEntries(
  customContext.keys().map((key) => [key.replace(/^\.\//, "").replace(/\.tsx$/, ""), customContext(key).default]),
)

export const defaultProps: MainProps = {
  videoUrl: null,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 300,
  theme: DEFAULT_THEME,
  captions: null,
  words: [],
  overlays: [],
  faces: [],
  audio: [],
  isolate: null,
}

/** Punch-in zoom on the video: eases to `scale` around (x, y) and back. */
function zoomAt(frame: number, zooms: PlacedOverlay[]): Zoom {
  const zoom = zooms.find((z) => frame >= z.from && frame < z.to)
  if (!zoom) return { scale: 1, originX: 0.5, originY: 0.5 }
  const target = typeof zoom.props.scale === "number" ? zoom.props.scale : 1.15
  const ease = Math.min(10, Math.floor((zoom.to - zoom.from) / 3))
  const k = Math.min(
    interpolate(frame, [zoom.from, zoom.from + ease], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }),
    interpolate(frame, [zoom.to - ease, zoom.to], [1, 0], { ...clamp, easing: Easing.in(Easing.cubic) }),
  )
  const x = typeof zoom.props.x === "number" ? zoom.props.x : 0.5
  const y = typeof zoom.props.y === "number" ? zoom.props.y : 0.4
  return { scale: 1 + (target - 1) * k, originX: x, originY: y }
}

/** Area the captions occupy: two lines centred on the chosen line. */
function captionsBox(settings: CaptionsSettings, p: MainProps, u: number): Box {
  const safe = safeArea(p.width, p.height)
  const h = 170 * u
  const bottomCentre = p.height - safe.bottom - h / 2
  let centre = bottomCentre
  if (settings.position === "center") centre = p.height * 0.5
  if (settings.position === "auto") {
    const bottoms = p.faces.flatMap((f) => (f.box ? [(f.box[1] + f.box[3]) * p.height] : [])).sort((a, b) => a - b)
    const faceBottom = bottoms.length ? bottoms[Math.floor(bottoms.length * 0.9)] : null
    centre = faceBottom === null ? bottomCentre : Math.min(bottomCentre, Math.max(p.height * 0.45, faceBottom + 40 * u + h / 2))
  }
  return { x: safe.left, y: centre - h / 2, w: p.width - safe.left - safe.right, h }
}

function OverlayView({ overlay, ...rest }: { overlay: PlacedOverlay } & Omit<OverlayProps, "props">) {
  const replaced = PACK.replaces[overlay.type]
  const Component = overlay.type === "custom"
    ? CUSTOM[overlay.component ?? ""]
    : overlay.type === "pack"
      ? PACK_COMPONENTS[overlay.component ?? ""]
      : (replaced && PACK_COMPONENTS[replaced]) || BUILTIN[overlay.type]
  if (!Component) throw new Error(`Unknown overlay ${overlay.type}${overlay.component ? `/${overlay.component}` : ""}`)
  return <Component props={overlay.props} {...rest} />
}

/** Same rule as the worker (graphics.js isFullFrame). */
function isFullFrame(o: PlacedOverlay) {
  const full = PACK.fullFrame ?? []
  return o.type === "fullscreen" || o.props.fullFrame === true
    || ((o.type === "image" || o.type === "video") && (o.props.position ?? "full") === "full")
    || (o.type === "pack" && full.includes(o.component ?? ""))
    || (Boolean(PACK.replaces[o.type]) && full.includes(PACK.replaces[o.type]))
}

function useFonts(families: string[]) {
  const [handle] = useState(() => delayRender("fonts"))
  useEffect(() => {
    // A variable font declares a range ("400 900"): load both ends.
    const specs = PACK.fonts.flatMap((f) => String(f.weight).split(" ").map((w) => `${f.style === "italic" ? "italic " : ""}${w} 64px "${f.family}"`))
    const loads = [
      ...specs,
      ...families.map((family) => `800 64px "${family}"`),
    ].map((spec) => document.fonts.load(spec, "Аа Bb 0").catch(() => []))
    Promise.all(loads).then(() => document.fonts.ready).then(() => continueRender(handle))
  }, [handle]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function Main(p: MainProps) {
  const frame = useCurrentFrame()
  const theme = { ...DEFAULT_THEME, ...PACK.theme, ...p.theme }
  useFonts([...new Set([theme.font, theme.displayFont, theme.captionFont])])

  const u = Math.min(p.width, p.height) / 1080
  const zooms = useMemo(() => p.overlays.filter((o) => o.type === "zoom"), [p.overlays])
  const layers = p.overlays.filter((o) => o.type !== "zoom")
  const captions = p.captions && p.captions.style !== "off" ? p.captions : null
  const captionArea = useMemo(() => (captions ? captionsBox(captions, p, u) : null), [captions, p, u])
  const layout: Layout = useMemo(() => ({
    width: p.width, height: p.height, fps: p.fps, u,
    safe: safeArea(p.width, p.height),
    captions: captionArea,
    faces: p.faces ?? [],
    zoomAt: (f: number) => zoomAt(f, zooms),
  }), [p.width, p.height, p.fps, u, captionArea, p.faces, zooms])
  const { scale, originX, originY } = zoomAt(frame, zooms)
  const captionsHidden = layers.some((o) => o.props.hideCaptions === true && frame >= o.from && frame < o.to)
  // Captions over a light card switch style; over a full-frame clip or photo they stay as over video unless props.backdrop says otherwise.
  const backdrop = layers.some((o) => isFullFrame(o) && frame >= o.from && frame < o.to
    && (o.props.backdrop === "graphic" || (o.props.backdrop !== "video" && o.type !== "image" && o.type !== "video"))) ? "graphic" : "video"
  const isolate = p.isolate ?? null
  const shown = isolate ? (isolate.layer === "overlay" ? layers.filter((o) => o.id === isolate.id) : []) : layers
  const CaptionsComponent = PACK_CAPTIONS ?? Captions

  return (
    <LayoutContext.Provider value={layout}>
      <AbsoluteFill style={{ background: isolate ? "transparent" : "#000", fontFamily: `"${theme.font}", system-ui, sans-serif` }}>
        {!isolate && (
          <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: `${originX * 100}% ${originY * 100}%` }}>
            {p.videoUrl && <OffthreadVideo src={p.videoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </AbsoluteFill>
        )}
        {shown.map((overlay) => (
          <Sequence key={overlay.id} from={overlay.from} durationInFrames={Math.max(1, overlay.to - overlay.from)} layout="none">
            <OverlayContext.Provider value={{ id: overlay.id, from: overlay.from, to: overlay.to }}>
              <AbsoluteFill>
                <OverlayView overlay={overlay} theme={theme} u={u} width={p.width} height={p.height} />
              </AbsoluteFill>
            </OverlayContext.Provider>
          </Sequence>
        ))}
        {!isolate && p.audio?.length ? <AudioTracks tracks={p.audio} words={p.words} fps={p.fps} /> : null}
        {captions && captionArea && (!isolate || isolate.layer === "captions") && (
          <CaptionsComponent words={p.words} settings={captions} theme={theme} u={u} width={p.width} height={p.height} hidden={captionsHidden} box={captionArea} backdrop={backdrop} />
        )}
      </AbsoluteFill>
    </LayoutContext.Provider>
  )
}

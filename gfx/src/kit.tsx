// Interface kit: the things a talking-head video about tools shows most —
// an app window, a phone, a chat with a typed question and an answer, a
// notification, a document, a cursor that clicks, switches and buttons.
// Controlled views: they draw a state and keep no time of their own. The
// scene decides the state from the frame (moves.typeOn, chatAt, cursorPath).
// Colours and fonts come from the version's theme (the pack's look).
//
//   import { AppWindow, ChatWindow, chatAt, Cursor, Illustration } from "cutroom"
import React, { createContext, useContext, type CSSProperties, type ReactNode } from "react"
import { Img } from "remotion"
import { useLayout } from "./layout"
import { caretOn, typeOn } from "./moves"
import { ILLUSTRATIONS } from "./pack"
import { DEFAULT_THEME, type Theme } from "./types"

export const ThemeContext = createContext<Theme>(DEFAULT_THEME)
/** The version's theme: the pack's look with graphics.json overrides. */
export const useTheme = () => useContext(ThemeContext)

/** Light surfaces on a dark look and the other way round: "auto" follows the look's card. */
export type Tone = "auto" | "light" | "dark"
type Palette = { surface: string; subtle: string; text: string; mute: string; line: string; accent: string; onAccent: string; font: string; display: string }

const luminance = (hex: string) => {
  const v = hex.replace("#", "")
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Surface colours of the kit for a tone. */
export function palette(theme: Theme, tone: Tone = "auto"): Palette {
  const base = { accent: theme.accent, onAccent: theme.accentForeground, font: `"${theme.font}", system-ui, sans-serif`, display: `"${theme.displayFont}", "${theme.font}", sans-serif` }
  const cardIsLight = luminance(theme.card) > 0.5
  const light = tone === "light" || (tone === "auto" && cardIsLight)
  if (light) {
    const surface = cardIsLight ? theme.card : "#FFFFFF"
    const text = cardIsLight ? theme.cardForeground : "#15171A"
    return { ...base, surface, text, subtle: luminance(surface) > 0.97 ? "#EEF1F3" : "#FFFFFF", mute: "#5C6470", line: "#D5DAE0" }
  }
  const surface = cardIsLight ? "#1B1F26" : theme.card
  const text = cardIsLight ? "#F5F6F8" : theme.cardForeground
  return { ...base, surface, text, subtle: "#272C35", mute: "#A6ADB8", line: "#363C47" }
}

const usePalette = (tone: Tone = "auto") => palette(useTheme(), tone)
const useU = () => {
  try { return useLayout().u } catch { return 1 }
}

// ---------- icons --------------------------------------------------------------

export type IconName = "send" | "plus" | "file" | "check" | "close" | "search" | "bell" | "settings" | "lock" | "user" | "image" | "mic" | "clip" | "more" | "back" | "sparkle" | "heart" | "star" | "play" | "home" | "mail" | "trash" | "copy" | "warning"
const PATHS: Record<IconName, ReactNode> = {
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h5" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  clip: <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.3 17a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  back: <path d="M15 5 8 12l7 7" />,
  sparkle: <path d="M12 3c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9Z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8Z" />,
  play: <path d="M8 5v14l11-7Z" />,
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4Z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  warning: <path d="M12 3.5 2.5 20h19ZM12 10v4.5M12 17.2v.3" />,
}
export const ICONS = Object.keys(PATHS) as IconName[]

/** A line icon in the kit's style: 24-grid, 1.7 stroke. `size` in px at 1080. */
export function Icon({ name, size = 32, color = "currentColor", strokeWidth = 1.7 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const u = useU()
  return (
    <svg aria-hidden width={size * u} height={size * u} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {PATHS[name] ?? PATHS.sparkle}
    </svg>
  )
}

// ---------- surfaces -------------------------------------------------------------

/** A desktop or web app window: title bar with the product name, content below. Sizes in px at 1080. */
export function AppWindow({ title, children, width = 860, height = 980, tone = "auto", headerRight, style }: { title: string; children?: ReactNode; width?: number; height?: number; tone?: Tone; headerRight?: ReactNode; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return (
    <div style={{ width: width * u, height: height * u, display: "flex", flexDirection: "column", background: c.surface, color: c.text, fontFamily: c.font, borderRadius: 22 * u, border: `${Math.max(1, u)}px solid ${c.line}`, boxShadow: `0 ${24 * u}px ${70 * u}px rgba(0,0,0,.16), 0 ${2 * u}px ${6 * u}px rgba(0,0,0,.06)`, overflow: "hidden", boxSizing: "border-box", ...style }}>
      <div style={{ height: 96 * u, flexShrink: 0, display: "flex", alignItems: "center", gap: 18 * u, padding: `0 ${30 * u}px`, borderBottom: `${Math.max(1, u)}px solid ${c.line}` }}>
        <div style={{ display: "flex", gap: 10 * u }}>{["#FF5F57", "#FEBC2E", "#28C840"].map((dot) => <span key={dot} style={{ width: 16 * u, height: 16 * u, borderRadius: 99, background: dot, opacity: 0.9 }} />)}</div>
        <div style={{ flex: 1, fontFamily: c.display, fontSize: 34 * u, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {headerRight}
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  )
}

/** A phone: rounded body, status bar, an app's header and content. Width in px at 1080; the height follows 9:19.5. */
export function PhoneFrame({ title, children, width = 560, tone = "auto", time = "9:41", style }: { title?: string; children?: ReactNode; width?: number; tone?: Tone; time?: string; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  const w = width * u, h = w * 2.06
  return (
    <div style={{ width: w, height: h, borderRadius: w * 0.14, padding: w * 0.028, background: "#0F1115", boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,.28)`, boxSizing: "border-box", ...style }}>
      <div style={{ width: "100%", height: "100%", borderRadius: w * 0.115, background: c.surface, color: c.text, fontFamily: c.font, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
        <div style={{ height: w * 0.12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${w * 0.08}px`, fontSize: w * 0.038, fontWeight: 700 }}>
          <span>{time}</span>
          <span style={{ position: "absolute", left: "50%", top: w * 0.03, width: w * 0.3, height: w * 0.075, marginLeft: -w * 0.15, borderRadius: 99, background: "#0F1115" }} />
          <span style={{ display: "flex", gap: w * 0.012, alignItems: "flex-end" }}>{[0.4, 0.6, 0.8, 1].map((k) => <span key={k} style={{ width: w * 0.01, height: w * 0.03 * k, background: c.text, borderRadius: 2 }} />)}</span>
        </div>
        {title && <div style={{ padding: `${w * 0.02}px ${w * 0.07}px ${w * 0.04}px`, fontFamily: c.display, fontSize: w * 0.07, fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</div>}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  )
}

// ---------- chat -------------------------------------------------------------------

/** One message. The question sits right in a bubble, the answer reads left. */
export function ChatMessage({ role, children, fontSize = 34, tone = "auto", style }: { role: "user" | "assistant"; children: ReactNode; fontSize?: number; tone?: Tone; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  const user = role === "user"
  return (
    <div style={{ display: "flex", justifyContent: user ? "flex-end" : "flex-start", gap: 16 * u, fontSize: fontSize * u, lineHeight: 1.4, ...style }}>
      {!user && <div style={{ width: 44 * u, height: 44 * u, flexShrink: 0, borderRadius: 99, display: "grid", placeItems: "center", background: c.subtle, color: c.text }}><Icon name="sparkle" size={26} /></div>}
      <div style={{ maxWidth: user ? "82%" : "86%", padding: user ? `${18 * u}px ${26 * u}px` : `${4 * u}px 0`, background: user ? c.subtle : "transparent", borderRadius: 26 * u, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</div>
    </div>
  )
}

/** The input field: typed text with a caret, or the placeholder. */
export function Composer({ text, placeholder = "Спросите что-нибудь", caret = false, fontSize = 32, tone = "auto", sending = 0, style }: { text: string; placeholder?: string; caret?: boolean; fontSize?: number; tone?: Tone; sending?: number; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16 * u, padding: `${18 * u}px ${20 * u}px`, borderRadius: 30 * u, border: `${Math.max(1.5, 1.5 * u)}px solid ${c.line}`, background: c.surface, boxShadow: `0 ${4 * u}px ${18 * u}px rgba(0,0,0,.05)`, ...style }}>
      <span style={{ color: c.mute, display: "flex", paddingBottom: 6 * u }}><Icon name="plus" size={30} /></span>
      <div style={{ flex: 1, minWidth: 0, fontSize: fontSize * u, lineHeight: 1.4, color: text ? c.text : c.mute, whiteSpace: "pre-wrap", overflowWrap: "anywhere", paddingBottom: 4 * u }}>
        {text || placeholder}
        {caret && <span style={{ color: c.accent, fontWeight: 300 }}>▏</span>}
      </div>
      <span style={{ width: 52 * u, height: 52 * u, flexShrink: 0, borderRadius: 99, display: "grid", placeItems: "center", background: text || sending ? c.text : c.line, color: c.surface, transform: `scale(${1 - 0.12 * sending})` }}><Icon name="send" size={28} /></span>
    </div>
  )
}

export type ChatScriptLine = {
  role: "user" | "assistant"
  text: string
  /** Frame (of the element) the message appears; for a typed user message — when it is sent. */
  at?: number
  /** A user message typed in the field from typeFrom to typeTo, then sent. */
  typeFrom?: number
  typeTo?: number
}

/**
 * The chat at a frame: which messages are visible (with their entrance
 * progress), what is in the input field, and whether the caret blinks.
 * Assistant answers stream in over `stream` frames.
 */
export function chatAt(script: ChatScriptLine[], frame: number, { fps = 30, stream = 18 } = {}) {
  const history: { role: "user" | "assistant"; text: string; enter: number }[] = []
  let draft = "", typing = false, sending = 0
  for (const line of script) {
    const typed = line.role === "user" && line.typeFrom !== undefined && line.typeTo !== undefined
    const sendAt = typed ? Math.max(line.typeTo!, line.at ?? line.typeTo! + Math.round(fps * 0.3)) : line.at ?? 0
    if (typed && frame >= line.typeFrom! && frame < sendAt) {
      draft = typeOn(line.text, frame, line.typeFrom!, line.typeTo!)
      typing = frame < line.typeTo!
      sending = frame >= sendAt - 4 ? (frame - (sendAt - 4)) / 4 : 0
    }
    if (frame < sendAt) continue
    const enter = Math.min(1, (frame - sendAt) / 8)
    const text = line.role === "assistant" ? typeOn(line.text, frame, sendAt + 4, sendAt + 4 + stream + Math.round(line.text.length / 6)) : line.text
    history.push({ role: line.role, text, enter })
  }
  return { history, draft, typing, caret: draft ? caretOn(frame, typing, fps) : false, sending }
}

/**
 * A chat app: header with the product name, history, input field. Pass the
 * state from chatAt(); the last messages stay visible (older ones scroll up).
 */
export function ChatWindow({ app, state, width = 860, height = 960, fontSize = 40, tone = "auto", placeholder, style }: { app: string; state: ReturnType<typeof chatAt>; width?: number; height?: number; fontSize?: number; tone?: Tone; placeholder?: string; style?: CSSProperties }) {
  const u = useU()
  return (
    <AppWindow title={app} width={width} height={height} tone={tone} style={style}>
      <div style={{ position: "absolute", inset: 0, padding: 28 * u, display: "flex", flexDirection: "column", gap: 24 * u }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 26 * u, overflow: "hidden" }}>
          {state.history.map((m, i) => (
            <ChatMessage key={i} role={m.role} fontSize={fontSize} tone={tone} style={{ opacity: m.enter, transform: `translateY(${(1 - m.enter) * 24 * u}px)` }}>{m.text || " "}</ChatMessage>
          ))}
        </div>
        <Composer text={state.draft} caret={state.caret} fontSize={fontSize - 2} tone={tone} placeholder={placeholder} sending={state.sending} />
      </div>
    </AppWindow>
  )
}

// ---------- other pieces --------------------------------------------------------------

/** A push notification: app, title, body. */
export function Notification({ app, title, body, icon = "bell", time = "сейчас", width = 820, tone = "auto", style }: { app: string; title: string; body?: string; icon?: IconName; time?: string; width?: number; tone?: Tone; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return (
    <div style={{ width: width * u, display: "flex", gap: 22 * u, padding: `${24 * u}px ${28 * u}px`, borderRadius: 32 * u, background: c.surface, color: c.text, fontFamily: c.font, boxShadow: `0 ${18 * u}px ${50 * u}px rgba(0,0,0,.2)`, border: `${Math.max(1, u)}px solid ${c.line}`, boxSizing: "border-box", ...style }}>
      <div style={{ width: 76 * u, height: 76 * u, flexShrink: 0, borderRadius: 20 * u, background: c.accent, color: c.onAccent, display: "grid", placeItems: "center" }}><Icon name={icon} size={40} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26 * u, color: c.mute, fontWeight: 600 }}><span>{app}</span><span>{time}</span></div>
        <div style={{ fontSize: 34 * u, fontWeight: 700, marginTop: 4 * u, lineHeight: 1.2 }}>{title}</div>
        {body && <div style={{ fontSize: 30 * u, marginTop: 6 * u, lineHeight: 1.3, color: c.mute }}>{body}</div>}
      </div>
    </div>
  )
}

/** A document page: file name, then real lines of text. `highlight` marks lines by index with the accent. */
export function Doc({ title, lines, highlight = [], width = 780, tone = "auto", fontSize = 30, style }: { title: string; lines: string[]; highlight?: number[]; width?: number; tone?: Tone; fontSize?: number; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return (
    <div style={{ width: width * u, borderRadius: 20 * u, background: c.surface, color: c.text, fontFamily: c.font, border: `${Math.max(1, u)}px solid ${c.line}`, boxShadow: `0 ${20 * u}px ${60 * u}px rgba(0,0,0,.14)`, overflow: "hidden", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 * u, padding: `${20 * u}px ${26 * u}px`, borderBottom: `${Math.max(1, u)}px solid ${c.line}`, fontSize: 28 * u, fontWeight: 600 }}><Icon name="file" size={30} color={c.mute} />{title}</div>
      <div style={{ padding: `${24 * u}px ${30 * u}px`, display: "grid", gap: 14 * u }}>
        {lines.map((line, i) => (
          <div key={i} style={{ fontSize: fontSize * u, lineHeight: 1.35, padding: `${2 * u}px ${8 * u}px`, margin: `0 ${-8 * u}px`, borderRadius: 8 * u, background: highlight.includes(i) ? `${c.accent}55` : "transparent" }}>{line}</div>
        ))}
      </div>
    </div>
  )
}

/** A button with a press state (0–1, from moves.press or cursorPath().press). */
export function Button({ label, press = 0, primary = true, tone = "auto", style }: { label: string; press?: number; primary?: boolean; tone?: Tone; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: `${20 * u}px ${38 * u}px`, borderRadius: 18 * u, background: primary ? c.accent : c.subtle, color: primary ? c.onAccent : c.text, fontFamily: c.font, fontSize: 32 * u, fontWeight: 700, transform: `scale(${1 - 0.06 * press})`, ...style }}>{label}</div>
}

/** A switch; `on` 0–1 animates the knob. */
export function Toggle({ on, tone = "auto", size = 1 }: { on: number; tone?: Tone; size?: number }) {
  const c = usePalette(tone)
  const u = useU() * size
  const k = Math.max(0, Math.min(1, on))
  return (
    <div style={{ width: 92 * u, height: 54 * u, borderRadius: 99, padding: 5 * u, boxSizing: "border-box", background: k > 0.5 ? c.accent : c.line, transition: "none" }}>
      <div style={{ width: 44 * u, height: 44 * u, borderRadius: 99, background: "#FFFFFF", transform: `translateX(${k * 38 * u}px)`, boxShadow: `0 ${2 * u}px ${6 * u}px rgba(0,0,0,.2)` }} />
    </div>
  )
}

/** A settings row: label, optional hint, a control on the right. */
export function SettingRow({ label, hint, children, tone = "auto", style }: { label: string; hint?: string; children?: ReactNode; tone?: Tone; style?: CSSProperties }) {
  const c = usePalette(tone)
  const u = useU()
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 * u, padding: `${22 * u}px ${28 * u}px`, borderBottom: `${Math.max(1, u)}px solid ${c.line}`, fontFamily: c.font, color: c.text, ...style }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 32 * u, fontWeight: 600 }}>{label}</div>{hint && <div style={{ fontSize: 26 * u, color: c.mute, marginTop: 4 * u }}>{hint}</div>}</div>
      {children}
    </div>
  )
}

/** A progress bar, value 0–1. */
export function Progress({ value, width = 600, tone = "auto" }: { value: number; width?: number; tone?: Tone }) {
  const c = usePalette(tone)
  const u = useU()
  return <div style={{ width: width * u, height: 18 * u, borderRadius: 99, background: c.line, overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: "100%", background: c.accent, borderRadius: 99 }} /></div>
}

/** The pointer, tip at (x, y) in the parent's pixels; press 0–1 shrinks it on a click. */
export function Cursor({ x, y, press = 0, size = 1 }: { x: number; y: number; press?: number; size?: number }) {
  const u = useU() * size
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${1 - 0.14 * press})`, transformOrigin: "0 0", zIndex: 20, filter: `drop-shadow(0 ${2 * u}px ${3 * u}px rgba(0,0,0,.3))` }}>
      {press > 0 && <div style={{ position: "absolute", left: -30 * u, top: -30 * u, width: 60 * u, height: 60 * u, borderRadius: 99, border: `${3 * u}px solid rgba(255,255,255,${0.8 * press})`, transform: `scale(${0.6 + press})` }} />}
      <svg width={44 * u} height={54 * u} viewBox="0 0 42 52"><path d="M3 3v38l10-9 8 17 8-4-8-17 16-2Z" fill="#15171A" stroke="#FFFFFF" strokeWidth={2.6} strokeLinejoin="round" /></svg>
    </div>
  )
}

// ---------- illustrations ------------------------------------------------------------

/** Ids of the pack's ready pictures (pack/illustrations.json). */
export const ILLUSTRATION_IDS = Object.keys(ILLUSTRATIONS)

/**
 * A ready picture from the pack by id: an object, a character, an emotion.
 * `size` is the longer side in px at 1080. Unknown ids throw: check
 * illustrations.md for the list.
 */
export function Illustration({ id, size = 320, style }: { id: string; size?: number; style?: CSSProperties }) {
  const u = useU()
  const item = ILLUSTRATIONS[id]
  if (!item) throw new Error(`Нет иллюстрации «${id}» в пакете (см. illustrations.md)`)
  const k = (size * u) / Math.max(item.width, item.height)
  return <Img src={item.src} style={{ width: item.width * k, height: item.height * k, objectFit: "contain", display: "block", ...style }} />
}

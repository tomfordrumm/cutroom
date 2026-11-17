// One move of the library on a small stage, for the sheet `cutroom gfx moves`.
import React from "react"
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { Button, Cursor, Icon } from "./kit"
import gallery from "./moves-gallery.json"
import { along, camera, countUp, cursorPath, ease, exit, gather, iris, maskRise, morph, popIn, press, rectStyle, rise, shake, slideIn, squash, sweep, typeOn, wordRise, zoomThrough } from "./moves"

const INK = "#15171A", ACCENT = "#2F5BFF", CARD = "#FFFFFF", GROUND = "#EEF0F3", LINE = "#D5DAE0"
const S = 540
const card: React.CSSProperties = { background: CARD, borderRadius: 18, border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(0,0,0,.08)" }

function Demo({ move, f }: { move: string; f: number }) {
  const center: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center" }
  const text: React.CSSProperties = { fontFamily: "Inter Variable, sans-serif", fontWeight: 800, fontSize: 44, color: INK }
  switch (move) {
    case "rise": return <div style={center}><div style={{ ...card, ...text, padding: "22px 34px", ...rise(f, { delay: 2 }) }}>Карточка</div></div>
    case "popIn": return <div style={center}><div style={{ width: 150, height: 150, borderRadius: 40, background: ACCENT, display: "grid", placeItems: "center", color: "#fff", ...popIn(f, { delay: 2 }) }}><Icon name="star" size={80} /></div></div>
    case "maskRise": return <div style={center}><div style={{ overflow: "hidden" }}><div style={{ ...text, fontSize: 64, ...maskRise(f, { delay: 2 }) }}>Строка</div></div></div>
    case "wordRise": return <div style={center}><div style={{ ...text, display: "flex", gap: 14 }}>{wordRise("Слово за словом", f, { delay: 2 }).map((w, i) => <span key={i} style={{ display: "inline-block", ...w.style }}>{w.word}</span>)}</div></div>
    case "slideIn": return <div style={center}><div style={{ ...card, ...text, padding: "22px 34px", ...slideIn(f, { delay: 2, from: "left", distance: 260 }) }}>Справа</div></div>
    case "typeOn": return <div style={center}><div style={{ ...card, width: 440, padding: "22px 26px", fontFamily: "Inter Variable, sans-serif", fontSize: 32, color: INK }}>{typeOn("Сделай план на неделю", f, 2, 26)}<span style={{ color: ACCENT }}>▏</span></div></div>
    case "countUp": return <div style={center}><div style={{ ...text, fontSize: 120, color: ACCENT }}>{countUp(f, 0, 87, 2, 26)}%</div></div>
    case "sweep": return <div style={center}><div style={{ ...text, fontSize: 60, position: "relative" }}><span style={{ position: "absolute", left: -6, right: -6, bottom: 6, height: 30, background: "#FFD84D", transformOrigin: "left", transform: `scaleX(${sweep(f, 4)})` }} /><span style={{ position: "relative" }}>Главное</span></div></div>
    case "press": return <div style={center}><div style={{ transform: `scale(${press(f, 10)})` }}><Button label="Отправить" /></div></div>
    case "cursorPath": {
      const c = cursorPath(f, [{ x: 80, y: 420, at: 0 }, { x: 300, y: 290, at: 16, click: true }, { x: 300, y: 290, at: 29 }])
      return <><div style={{ position: "absolute", left: 170, top: 250 }}><Button label="Готово" press={c.press} /></div><Cursor x={c.x} y={c.y} press={c.press} /></>
    }
    case "shake": return <div style={center}><div style={{ ...card, ...text, padding: "22px 34px", color: "#C93C3C", transform: `translateX(${shake(f, 6, { amplitude: 22 })}px)` }}>Ошибка</div></div>
    case "squash": {
      const fall = Math.min(1, ease.in(Math.min(1, f / 10)))
      const s = squash(f, 10, { amount: 0.3 })
      return <div style={{ position: "absolute", left: S / 2 - 60, top: 120 + fall * 240, width: 120, height: 120, borderRadius: 999, background: ACCENT, transformOrigin: "50% 100%", transform: `scale(${s.scaleX}, ${s.scaleY})` }} />
    }
    case "gather": return <div style={center}><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 90px)", gap: 16 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} style={{ height: 90, borderRadius: 18, background: i % 2 ? ACCENT : INK, ...gather(f, i, 6, 2) }} />)}</div></div>
    case "morph": { const r = morph(f, { x: 190, y: 220, w: 160, h: 100, r: 50 }, { x: 40, y: 40, w: 460, h: 460, r: 24 }, 4, 24); return <div style={{ ...rectStyle(r), background: ACCENT }} /> }
    case "zoomThrough": return <div style={{ position: "absolute", inset: 0, ...zoomThrough(f, { x: 330, y: 330, w: 120, h: 120 }, { width: S, height: S }, 4, 26) }}>{[0, 1, 2, 3].map((i) => <div key={i} style={{ position: "absolute", left: 90 + (i % 2) * 240, top: 90 + Math.floor(i / 2) * 240, width: 120, height: 120, borderRadius: 18, background: i === 3 ? ACCENT : LINE }} />)}</div>
    case "iris": return <><div style={{ position: "absolute", inset: 0, background: GROUND }} /><div style={{ position: "absolute", inset: 0, background: ACCENT, ...iris(f, 270, 270, { width: S, height: S }, 4, 26) }} /></>
    case "camera": {
      const p = along([{ x: 120, y: 400 }, { x: 420, y: 140 }], Math.min(1, f / 24))
      return <div style={{ position: "absolute", width: S, height: S, ...camera(f, [{ at: 0, x: 120, y: 400, scale: 1.6 }, { at: 24, x: 420, y: 140, scale: 1.6 }, { at: 29, scale: 1 , x: 270, y: 270 }], { width: S, height: S }) }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${LINE} 2px, transparent 2px)`, backgroundSize: "36px 36px" }} />
        <div style={{ position: "absolute", left: p.x - 30, top: p.y - 30, width: 60, height: 60, borderRadius: 999, background: ACCENT }} />
      </div>
    }
    case "exit": { const e = exit(f, 30, { duration: 14, distance: 60 }); return <div style={center}><div style={{ ...card, ...text, padding: "22px 34px", ...e }}>Уходит</div></div> }
    default: return null
  }
}

export function MovesGallery({ move }: { move: string }) {
  const f = useCurrentFrame()
  const info = gallery.find((m) => m.name === move)
  return (
    <AbsoluteFill style={{ background: GROUND, overflow: "hidden" }}>
      <Demo move={move} f={f} />
      <div style={{ position: "absolute", left: 18, top: 14, right: 18, fontFamily: "Inter Variable, sans-serif", color: INK }}>
        <div style={{ fontSize: 26, fontWeight: 800 }}>{move} <span style={{ color: "#5C6470", fontWeight: 600 }}>· кадр {f}</span></div>
        {f === 0 && <div style={{ fontSize: 19, color: "#5C6470", marginTop: 4, lineHeight: 1.25 }}>{info?.say}</div>}
      </div>
    </AbsoluteFill>
  )
}

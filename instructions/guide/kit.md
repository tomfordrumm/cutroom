# Свой компонент и набор интерфейса

Полное API модуля `cutroom` для своих компонентов, кроме движений (они в `guide/motion.md`). Исходники Cutroom читать не нужно: всё, что можно импортировать, перечислено здесь.

## Компонент

```tsx
// custom/ChatStory.tsx
import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion"
import { AppWindow, chatAt, ChatWindow, Cursor, cursorPath, moves, useLayout, useTheme, type OverlayProps } from "cutroom"

export default function ChatStory({ props, theme, u, width, height }: OverlayProps<{ beat: string }>) {
  const frame = useCurrentFrame()                      // кадры от начала элемента
  const { fps, durationInFrames } = useVideoConfig()   // длина элемента в кадрах
  const layout = useLayout()
  return <AbsoluteFill style={{ background: theme.background }}>…</AbsoluteFill>
}
```

- Файл `custom/Имя.tsx` (имя с заглавной латинской), `export default function Имя(...)`, элемент `{ "type": "custom", "component": "Имя", "props": { … } }`.
- Импортировать можно `react`, `remotion` и `cutroom`. Явно импортируй `React`, если пишешь JSX.
- Компонент получает `OverlayProps`: `props` (из `graphics.json`), `theme` (тема выбранного стиля), `u` (пиксель при короткой стороне 1080 — умножай на него все размеры), `width`, `height` (кадр в пикселях).
- Компонент рисуется внутри `Sequence` на время элемента: `useCurrentFrame()` считает от его начала, `useVideoConfig().durationInFrames` — его длина, `fps` — частота ролика.
- С `props.fullFrame: true` компонент закрывает автора и **рисует фон сам**. Без него он поверх видео: держись свободных зон (`useZoneStyle`, `zoneFor`), не закрывай лицо и субтитры.
- Один компонент на сквозной образ: передавай этап истории в `props` (`beat`, `stage`), а не пиши компонент на каждую сцену. Но один компонент — не один кадр: на каждом этапе предмет стоит на своём месте и в своём масштабе, а на стыках превращается (`morph`, `zoomThrough`, `camera`, `iris`). Сравнение автора — отдельный этап со своим миром во весь кадр, не иконка внутри окна. Каркас — в `guide/storyboard.md`.
- Всё зависит только от кадра: никаких CSS-анимаций, `transition`, таймеров, `Math.random()`, `Date`. Картинки — `Img` из `remotion` или `Illustration`.
- Кириллические строки в коде — текст на экране: перечисли их в `text` сцены, проверка сверяет. Персонажей и предметы фигурами SVG не рисуй.

## Раскладка

- `useLayout()` → `{ width, height, fps, u, safe, captions, faces, zoomAt }`:
  - `safe` — отступы площадки `{ top, right, bottom, left }` в пикселях (интерфейс Shorts, Reels, TikTok);
  - `captions` — где стоят субтитры `{ x, y, w, h }` или `null`; графика внизу кончается над `captions.y`;
  - `faces`, `zoomAt` — данные для `faceAt` и `faceUnion`.
- `useOverlay()` → `{ id, from, to }` — первый и последний кадр элемента в ролике (для `zoneFor`).
- `useZoneStyle(position)` → CSS блока в свободной зоне: `auto`, `top`, `center`, `bottom`, `above-face`, `below-face`.
- `zoneFor(layout, placement, from, to)` → `{ top, bottom }` — та же зона числами, если раскладываешь сам.
- `faceAt(layout, frame)` → `{ x, y, w, h }` или `null` — лицо в кадре ролика с учётом наезда; `faceUnion(layout, from, to)` — рамка лица за отрезок.
- `safeArea(width, height)` — отступы площадки для любого размера.
- `LayoutContext`, `OverlayContext` — контексты, на которых стоят хуки выше; напрямую обычно не нужны. `NO_ZOOM` — масштаб без наезда.

## Цвет и время

- `useTheme()` → `Theme`: `accent`, `accentForeground`, `accent2`, `background`, `deep`, `foreground`, `mute`, `line`, `card`, `cardForeground`, `radius`, `font`, `displayFont`, `captionFont`. Шрифт в CSS: `` `"${theme.displayFont}", sans-serif` ``. Бери только эти цвета: случайные выглядят чужими.
- `palette(theme, tone)` → `{ surface, subtle, text, mute, line, accent, onAccent, font, display }` — цвета поверхностей набора для `tone`.
- `ThemeContext` — контекст темы; `DEFAULT_THEME` — тема без пакета.
- `useEnterExit(delay)` → `{ enter, opacity }` — мягкий вход пружиной и короткий уход в конце элемента.
- `clamp` — `{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }` для `interpolate`.
- `readingSeconds(text)` — сколько секунд нужно, чтобы прочитать текст: около трёх слов в секунду плюс секунда.
- `paginate(words, perPage)` — страницы субтитров; нужен только пакетам, которые рисуют свои субтитры.
- Типы: `OverlayProps`, `Theme`, `Box`, `Word`, `FaceSample`, `CaptionsSettings`, `CaptionsProps`, `Tone`, `IconName`, `ChatScriptLine`, `Rect`, `CameraKey`, `Layout`, `Placement`, `Zone`, `Insets`, `Zoom`.

## Набор интерфейса

Готовые части интерфейса. Они рисуют состояние и не хранят время: что набрано, что нажато и что видно, решает сцена из кадра (`moves.typeOn`, `chatAt`, `cursorPath`). Цвета и шрифты — из стиля, размеры — в пикселях при 1080 (`u` части учитывают сами). У всех есть `tone` (`auto` — по карточкам стиля, `light`, `dark`) и `style` для своего CSS.

### Окна и устройства

- `AppWindow({ title, width = 860, height = 980, tone, headerRight, children })` — окно приложения или сайта: заголовок с названием продукта, содержимое ниже (потоком или `position: absolute`).
- `PhoneFrame({ title, width = 560, tone, time = "9:41", children })` — телефон с шапкой приложения, высота по пропорции экрана.

### Чат

```tsx
const { fps } = useVideoConfig()
const state = chatAt([
  { role: "user", text: "Сделай план на неделю", typeFrom: 6, typeTo: 40 },   // кадры элемента
  { role: "assistant", text: "Понедельник: …", at: 52 },
], frame, { fps })
<ChatWindow app="ChatGPT" state={state} width={860} height={1000} />
```

- `chatAt(script, frame, { fps = 30, stream = 18 })` → `{ history, draft, typing, caret, sending }`. Строка сценария `ChatScriptLine`: `role`, `text`, `at` (кадр появления; у набранного вопроса — отправки), `typeFrom`/`typeTo` (вопрос набирается в поле и уходит). Ответ ассистента печатается за `stream` кадров плюс время на длину текста.
- `ChatWindow({ app, state, width = 860, height = 960, fontSize = 40, tone, placeholder })` — окно целиком; старые сообщения уезжают вверх.
- `ChatMessage({ role, fontSize = 34, tone, children })` и `Composer({ text, placeholder, caret, fontSize = 32, tone, sending })` — по отдельности для своей компоновки.
- Простой чат — встроенный элемент `chat` в `graphics.json`. Свой компонент нужен, когда чат — часть большей сцены.

### Части

- `Notification({ app, title, body, icon = "bell", time = "сейчас", width = 820, tone })` — пуш-уведомление.
- `Doc({ title, lines, highlight = [], width = 780, fontSize = 30, tone })` — документ с настоящими строками; `highlight` — индексы строк под акцентом.
- `Button({ label, press = 0, primary = true, tone })` — `press` 0–1 из `moves.press` или `cursorPath`.
- `Toggle({ on, size = 1, tone })` — `on` 0–1, двигай ручку по кадру.
- `SettingRow({ label, hint, children, tone })` — строка настроек, справа `children` (обычно `Toggle`).
- `Progress({ value, width = 600, tone })` — `value` 0–1.
- `Cursor({ x, y, press = 0, size = 1 })` — указатель, кончик в точке `(x, y)` родителя; положение и клик — из `cursorPath`.
- `Icon({ name, size = 32, color, strokeWidth = 1.7 })` — линейная иконка. `ICONS` — все имена: `send`, `plus`, `file`, `check`, `close`, `search`, `bell`, `settings`, `lock`, `user`, `image`, `mic`, `clip`, `more`, `back`, `sparkle`, `heart`, `star`, `play`, `home`, `mail`, `trash`, `copy`, `warning`.

### Иллюстрации

- `Illustration({ id, size = 320 })` — картинка пакета по id из `illustrations.md`, `size` — длинная сторона. Двигай её целиком: вход, нажатие, перенос. Не дорисовывай ей части и не собирай персонажа из фигур рядом.
- `ILLUSTRATION_IDS` — список id пакета.
- Сгенерированную картинку (`images/<имя>.png`) из компонента не загрузить: ставь её отдельным элементом `sticker` или `image` поверх.

## Как собирать сцену

- Один главный объект в кадре. Поверх автора он маленький и с воздухом; во весь кадр — крупный, на бо́льшую часть безопасной зоны. Окно на весь кадр — для сцены, где важно содержимое; маленькое окно рядом с лицом — для короткой реплики.
- Содержимое настоящее по смыслу ролика: реальный вопрос, правдоподобный ответ, настоящие пункты настроек. Придуманное перечисли в `reply.md`.
- Причина видна: курсор кликает, вопрос печатается, переключатель щёлкает — и только потом меняется экран.
- Сквозной образ держи одним компонентом и двигай его через сцены: окно вырастает, сжимается, отъезжает, камера летит в деталь. Неподвижная рамка с меняющимся содержимым переносом не считается: `gfx review` поймает такой стык.

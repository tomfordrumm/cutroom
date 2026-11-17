# Набор интерфейса

Готовые части интерфейса в модуле `cutroom` для своих компонентов. Они рисуют состояние и не хранят время: что набрано, что нажато и что видно, решает сцена из кадра (`moves.typeOn`, `chatAt`, `cursorPath`). Цвета и шрифты берутся из выбранного стиля (`useTheme()`), размеры — в пикселях при 1080 (масштаб `u` компоненты учитывают сами).

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion"
import { AppWindow, chatAt, ChatWindow, Cursor, cursorPath, Illustration, moves, useZoneStyle, type OverlayProps } from "cutroom"
```

`tone` у компонентов: `auto` (по карточкам стиля), `light`, `dark`.

## Окна и устройства

- `AppWindow({ title, width, height, tone, headerRight, children })` — окно приложения или сайта: заголовок с названием продукта, содержимое ниже. Содержимое кладётся с `position: absolute` или потоком.
- `PhoneFrame({ title, width, tone, time, children })` — телефон с шапкой приложения. Высота — по пропорции экрана.

## Чат

```tsx
const { fps } = useVideoConfig()
const state = chatAt([
  { role: "user", text: "Сделай план на неделю", typeFrom: 6, typeTo: 40 },   // кадры элемента
  { role: "assistant", text: "Понедельник: …", at: 52 },
], frame, { fps })
<ChatWindow app="ChatGPT" state={state} width={860} height={1000} />
```

- `chatAt(script, frame, { fps, stream })` — состояние чата: набор в поле, отправка, ответ печатается за `stream` кадров. Вопрос с `typeFrom`/`typeTo` набирается и уходит в историю; без них сообщение появляется в `at`.
- `ChatWindow({ app, state, width, height, fontSize, tone, placeholder })` — окно целиком.
- `ChatMessage`, `Composer` — по отдельности, если нужна своя компоновка.
- Для простого чата хватает встроенного элемента `chat` в `graphics.json`, свой компонент нужен, когда чат — часть большей сцены.

## Части

- `Notification({ app, title, body, icon, time, width })` — пуш-уведомление.
- `Doc({ title, lines, highlight, width, fontSize })` — документ с настоящими строками; `highlight` — индексы строк, выделенных акцентом.
- `Button({ label, press, primary })`, `Toggle({ on })` (0–1, двигай ручку), `SettingRow({ label, hint, children })`, `Progress({ value })`.
- `Cursor({ x, y, press })` — указатель, кончик в точке `(x, y)` родителя. Положение и клик — из `cursorPath`.
- `Icon({ name, size, color })` — линейные иконки: `send`, `plus`, `file`, `check`, `close`, `search`, `bell`, `settings`, `lock`, `user`, `image`, `mic`, `clip`, `more`, `back`, `sparkle`, `heart`, `star`, `play`, `home`, `mail`, `trash`, `copy`, `warning`.

## Иллюстрации

- `Illustration({ id, size })` — готовая картинка пакета по id из `illustrations.md`, `size` — длинная сторона. Двигай её целиком: вход, нажатие, перенос. Не дорисовывай ей части и не собирай персонажа из фигур рядом.
- `ILLUSTRATION_IDS` — список id пакета.

## Как собирать сцену

- Один главный объект в кадре, много воздуха. Окно на весь кадр — для сцены, где важно содержимое; маленькое окно рядом с лицом — для короткой реплики.
- Содержимое настоящее по смыслу ролика: реальный вопрос, правдоподобный ответ, настоящие пункты настроек. Придуманное перечисли в `reply.md`.
- Причина видна: курсор кликает, вопрос печатается, переключатель щёлкает — и только потом меняется экран.
- Сквозной образ держи одним компонентом через несколько сцен и меняй его состояние: так сцены переносятся друг в друга сами.

# Пакеты вкуса

Пакет вкуса задаёт стиль монтажа: шрифты, цвета, субтитры, компоненты графики и правила для агента. Механику даёт ядро Cutroom, и она одинакова для любого пакета:

- поиск лица в записи (OpenCV YuNet);
- безопасные зоны площадок;
- раскладка элементов вокруг лица и субтитров;
- проверка раскладки `cutroom gfx review`;
- общие правила движения;
- встроенные элементы.

Встроенный пакет `base` («Базовый») лежит в образе. Остальные устанавливаются архивом в «Настройки → Пакет вкуса» и хранятся в `/data/packs/<id>`. Каждая версия ролика копирует свой пакет в `<версия>/pack`. Поэтому обновление или удаление пакета не меняет уже смонтированные версии и их финал.

## Состав

```
my-pack/
  pack.json                 манифест (обязательно)
  instructions/README.md    правила вкуса для агента (обязательно)
  instructions/*.md         дополнительные справочники
  components/*.tsx          компоненты Remotion
  fonts/*                   woff2, woff, ttf, otf
  assets/*                  картинки для компонентов: import x from "../assets/x.png"
  illustrations.json        готовые картинки предметов и персонажей по id (необязательно)
  illustrations/*           их файлы: png, webp, jpg
  examples/*                эталонные кадры для агента (png, jpg, webp, mp4)
```

Архив — zip, где `pack.json` лежит в корне или в единственной папке. Ссылки и пути за пределами пакета не допускаются, размер — до 200 МБ.

## pack.json

```json
{
  "format": "cutroom-pack-v1",
  "id": "my-pack",
  "name": "Мой стиль",
  "version": "1.0.0",
  "cutroom": 1,
  "description": "Одна-две фразы для карточки в настройках.",
  "author": "Автор пакета",
  "license": "Условия использования; лицензии шрифтов",
  "theme": { "accent": "#FFD84D", "accentForeground": "#111111", "background": "#0E0F12", "foreground": "#F7F7F5", "card": "#FFFFFF", "cardForeground": "#111111", "radius": 22, "font": "Inter Variable", "displayFont": "My Display", "captionFont": "My Display" },
  "captions": { "style": "plain", "position": "auto", "wordsPerPage": 3, "uppercase": false },
  "fonts": [{ "family": "My Display", "file": "fonts/my-display-800.woff2", "weight": 800, "style": "normal", "unicodeRange": "U+0400-045F" }],
  "looks": {
    "night": { "name": "Ночь", "description": "тёмный, контрастный", "theme": { "background": "#0E0F12", "accent": "#FFD84D", "displayFont": "My Display" } },
    "paper": { "name": "Бумага", "description": "светлый, спокойный", "theme": { "background": "#F3EFE6", "accent": "#E2553A" } }
  },
  "defaultLook": "night",
  "replaces": { "title": "HookCard", "captions": "PillCaptions" },
  "fullFrame": ["EndCard"]
}
```

- `id` задаётся латиницей в нижнем регистре; пакет с тем же `id` при установке заменяет прежний.
- `cutroom` — версия API ядра. Сейчас это `1`. Ядро не загрузит пакет для другой версии.
- `theme` задаёт цвета: `accent`, `accentForeground`, `accent2` (редкий второй акцент), `background`, `deep` (второй план фона), `foreground`, `mute` (вторичный текст), `line` (тонкие линии), `card`, `cardForeground`, а также `radius`, `font`, `displayFont`, `captionFont`.
- `looks` — именованные стили: у каждого `name`, `description` (агент выбирает по ней) и свой `theme` поверх общего. Агент пишет выбранный в `graphics.json → look`; без него действует `defaultLook`. Набор интерфейса и встроенные элементы берут цвета из стиля.
- `theme` и `captions` задают умолчания. Агент может переопределить отдельные поля в `graphics.json`, если этого требует бренд автора.
- `replaces` подменяет встроенный элемент своим компонентом. Заменить можно `title`, `fullscreen`, `list`, `stat`, `lowerThird`, `callout` и `captions`. Агент продолжает писать `"type": "title"`, а рисует его компонент пакета.
- `fullFrame` — компоненты, которые закрывают весь кадр. Проверка не считает их ошибкой и не ищет под ними лицо, а субтитры получают `backdrop: "graphic"`.
- `weight` у переменного шрифта задаётся диапазоном: `"400 900"`.
- Остальные компоненты агент вызывает как `{ "type": "pack", "component": "Имя", "props": { … } }`.

## Компоненты

```tsx
import { interpolate, useCurrentFrame } from "remotion"
import { clamp, useZoneStyle, type OverlayProps } from "cutroom"

export default function HookCard({ props, theme, u }: OverlayProps) {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 8], [0, 1], clamp)
  return (
    <div style={useZoneStyle(props.position ?? "auto")}>
      <div style={{ opacity, fontFamily: theme.displayFont, fontSize: 64 * u }}>{String(props.text ?? "")}</div>
    </div>
  )
}
```

- `u` — пиксель при короткой стороне 1080. Все размеры умножаются на него.
- Модуль `cutroom` даёт:
  - `useZoneStyle(position)` — блок в свободной зоне у лица;
  - `useLayout()` — безопасные зоны, место субтитров, размеры;
  - `faceAt` и `faceUnion` — рамка лица;
  - `useOverlay()` — кадры элемента;
  - `useEnterExit`, `clamp`, `readingSeconds`, `paginate`;
  - библиотеку движений `moves`, `ease`, `springs`;
  - набор интерфейса (`AppWindow`, `ChatWindow`, `Cursor`…), `useTheme()`, `Illustration`, `ILLUSTRATIONS`.
- Компонент субтитров (`replaces.captions`) получает `CaptionsProps`: `words`, `settings`, `theme`, `u`, `width`, `height`, `hidden`, `box` и `backdrop`. `box` — место, которое ядро отвело субтитрам. `backdrop` — что сейчас за ними: съёмка (`video`) или полноэкранная графика (`graphic`).
- Анимация должна зависеть только от кадра. CSS-анимации, таймеры и `Math.random()` запрещены.
- Компонент рисуется на прозрачном фоне, а проверка раскладки измеряет его по видимым пикселям. Полупрозрачная подложка на весь кадр считается элементом на весь кадр.

## Иллюстрации

Готовые картинки, из которых агент собирает сцены вместо рисования кодом: персонажи, эмоции, жесты, предметы.

```json
{
  "format": "cutroom-illustrations-v1",
  "style": "одной строкой, как выглядят",
  "license": "откуда и на каких условиях",
  "items": [
    { "id": "robot", "file": "illustrations/robot.png", "description": "робот, ИИ-помощник", "group": "люди" },
    { "id": "point", "file": "assets/stickers/point.png", "description": "автор указывает вправо", "group": "автор", "anchor": { "x": 590, "y": 410 } }
  ]
}
```

- `id` латиницей в нижнем регистре; `file` — в `illustrations/` или `assets/`; `description` — что изображено, агент выбирает по ней; `group` — раздел в списке; `anchor` — необязательная точка в пикселях файла (например, кончик пальца).
- Агент ставит их встроенным элементом `sticker` или `<Illustration id>` в своём компоненте; компоненты пакета берут их через `ILLUSTRATIONS` из модуля `cutroom`.
- Картинки одного пакета должны быть в одном стиле. Прозрачный фон, без надписей.

## Правила для агента

`instructions/README.md` описывает вкус и не повторяет механику:
- темп склейки и что вырезать;
- стиль субтитров;
- какие элементы графики ставить, на какие слова, как часто и сколько держать;
- props компонентов пакета;
- чего не делать.

Порядок важности для агента:
1. правки автора;
2. профиль вкуса автора;
3. пакет;
4. общие правила ядра.

## Проверка пакета

1. Установите архив в настройках. Ошибки манифеста покажутся сразу.
2. Смонтируйте тестовый ролик с этим пакетом.
3. В папке версии запустите `cutroom gfx review` и посмотрите лист кадров.

## Лицензии

Шрифты, изображения, музыку и звуки в пакете можно распространять, только если это разрешает их лицензия. Укажите её в `license`. Не копируйте узнаваемый стиль, имя или образ конкретного автора без его разрешения.

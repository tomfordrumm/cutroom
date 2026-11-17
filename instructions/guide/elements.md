# Справочник graphics.json

Все поля `graphics.json`, встроенные элементы и их `props`. Правила, когда и зачем ставить графику, — в `AGENTS.md`. Время везде — секунды исходника.

```json
{
  "format": "cutroom-graphics-v1",
  "look": "night",
  "theme": { "accent": "#FFD84D" },
  "captions": { "wordsPerPage": 3 },
  "overlays": [ { "id": "hook", "type": "title", "start": 16.3, "end": 19.0, "props": { "text": "…" } } ],
  "audio": [ { "id": "bed", "type": "music", "file": "library/music/Трек.mp3" } ]
}
```

## Оформление

- `look` — id стиля пакета из `layout.md`. Без него — стиль пакета по умолчанию.
- `theme` — только поля, которые меняешь:
  - цвета `#rrggbb`: `accent` (выделения, активное слово), `accentForeground` (текст на акценте), `accent2` (редкий второй акцент: второе состояние, «после»), `background` (фон полноэкранной графики), `deep` (второй план), `foreground` (текст на фоне), `mute` (вторичный текст), `line` (линии, края карточек), `card` и `cardForeground` (карточки поверх видео);
  - `radius` — скругление при 1080;
  - шрифты `font`, `displayFont`, `captionFont` — только семейства из пакета или `Inter Variable`.
- `captions` — `style` (`pill` | `plain` | `off`), `position` (`auto` — под лицом, `bottom` — над нижней безопасной зоной, `center`), `wordsPerPage` 1–8, `uppercase`. `"captions": null` — без субтитров.

## Общие props элементов

- `id` — уникальный, латиницей; на него ссылается `scenes.json → overlays`.
- `hideCaptions: true` — субтитры скрыты на время элемента. Для набора продиктованного текста и для элемента с крупным своим текстом.
- `fullFrame: true` — элемент на весь кадр: закрывает автора, голос звучит. Встроенные `chat` и `action` тогда рисуются на фоне темы; **свой компонент рисует фон сам** (`AbsoluteFill` с `theme.background` или своим). Полноэкранными считаются ещё `fullscreen`, `image`/`video` с `position: "full"` и компоненты пакета из его списка `fullFrame`. Для полноэкранных действует правило переноса между сценами.
- `backdrop` (`graphic` | `video`) — в каком стиле субтитры поверх полноэкранного элемента: `graphic` — как на светлой графике (по умолчанию для графики), `video` — как поверх видео (по умолчанию для `image`/`video`).
- `position` у `title`, `list`, `stat`, `chat`, `sticker`, `image`/`video` в зоне: `auto` (по умолчанию) — свободная зона выше или ниже лица над субтитрами; `above-face`, `below-face`, `top`, `bottom`, `center`. Ядро держит элементы внутри безопасной зоны площадки.

## Встроенные элементы

- `title` — плашка с текстом: `text`, `position`, `size` (`l` | `m`). Хук, заголовок мысли.
- `fullscreen` — графика на весь кадр поверх голоса: `kicker`, `title`, `body`, `align` (`left` | `center`).
- `list` — пункты появляются по очереди: `title`, `items` (массив строк), `numbered`, `position`.
- `stat` — крупное число или факт: `value`, `label`, `position`.
- `lowerThird` — подпись под лицом: `title`, `subtitle`.
- `callout` — короткая метка в точке кадра: `text`, `x`, `y` (0–1).
- `action` — схема «субъект → действие → объект → результат»: `subject` и `object` — `{ "label": "ChatGPT", "icon": "bot" }` или строка; `action` — глагол в 1–3 слова на стрелке; `result` — `{ "label": "выдумал", "icon": "cross", "tone": "error" }` (`tone`: `success`, `error`, `neutral`); `at` — когда появляется результат (доля элемента, по умолчанию 0.55); `layout` (`row` | `column`); `fullFrame`, иначе карточка в зоне `position`. Иконки: `person`, `people`, `bot`, `chat`, `question`, `document`, `settings`, `search`, `idea`, `code`, `data`, `money`, `time`, `check`, `cross`, `warning`, `lock`, `star`. Подписи — названия, не фразы. Это схема процесса с несколькими участниками, а не способ показать любую фразу.
- `chat` — окно чата: вопрос набирается и уходит, ответ печатается. `app` — название сервиса; `messages` — `[{ "role": "user", "text": "…", "type": [начало, конец] }, { "role": "assistant", "text": "…", "at": секунда }]` (секунды исходника внутри элемента: `type` — когда вопрос печатается, `at` — когда сообщение появляется); `tone` (`auto` | `light` | `dark`); `fullFrame` (тогда окно кончается над субтитрами), иначе `position`; `width`, `height`, `fontSize` (по умолчанию 42), `placeholder`. Сообщения чата — содержимое интерфейса и в лимит слов сцены не входят.
- `sticker` — готовая картинка: `id` из `illustrations.md` или `file: "images/<имя>.png"` (сгенерированная для этого ролика); `size` — длинная сторона, px при 1080, 160–900; `position` или `x`, `y` (0–1, центр); `side` (`left` | `right`) — с какой стороны встать, когда у лица нет места сверху и снизу; `caption` — подпись в 1–3 слова; `motion` (`pop` | `rise` | `none`).
- `image` — картинка автора или сгенерированная сцена: `file` (`assets/…`, `library/other/…`, `images/…`), `position` (`full` по умолчанию или зона), `fit` (`cover` | `contain`), `size` (0.3–1 ширины безопасной зоны, для зоны), `motion: "none"` — без медленного наезда на весь кадр.
- `video` — видеовставка или клип (`clips/<имя>.mp4`, см. `guide/clips.md`): `file`, `from` — с какой секунды вставки начать, `volume` 0–1 (по умолчанию без звука), `position`, `fit`, `size`, `aspect`.
- `zoom` — наезд камеры на автора: `scale` (1.05–1.4), `x`, `y` — точка приближения (обычно центр лица из `layout.md`). Без `props` кроме этих; не скрывает субтитры.
- `pack` — компонент пакета вкуса: `"component": "Имя"`, его `props` — в `layout.md` и `pack/instructions/`.
- `custom` — свой компонент: `"component": "Имя"` из `custom/Имя.tsx`, `props` — любые твои (см. `guide/kit.md`).

```json
{ "id": "screen", "type": "image", "start": 30.2, "end": 34.0, "props": { "file": "assets/settings.png", "fit": "contain" } }
```

## Звук: `audio`

```json
"audio": [
  { "id": "bed", "type": "music", "file": "library/music/Трек автора.mp3", "fadeIn": 1, "fadeOut": 2 },
  { "id": "w1", "type": "sfx", "file": "sounds/click/click-02.ogg", "at": 25.25 }
]
```

- `music` — `file`; без `start`/`end` идёт весь ролик через склейки без перезапуска; под речью тише, в паузах громче. `fadeIn`/`fadeOut` — секунды, `offset` — с какой секунды трека начать, `loop` — повторять короткий трек (по умолчанию да).
- `sfx` — `file`, `at` — секунда исходника, `duration` — обрезать длинный звук.
- `volume`, `pauseVolume` — доли от уровня из настроек автора, 0–1 (`0.5` ≈ на 6 дБ тише). Громче сделать нельзя. Обычно не пиши.
- Файлы — только из `media.md`: `library/music/…`, `library/sfx/…`, `sounds/<роль>/<файл>`. Роли встроенного набора: `click`, `key`, `toggle`, `pop`, `open`, `close`, `scroll`, `success`, `notify`, `error`, `glitch`, `rise`, `fall`, `paper`, `impact`, `coins`, `glass`.

## Что проверяет `cutroom gfx check`

- Формат, известные `type`, существующие файлы и иллюстрации, `start < end` в пределах исходника.
- Сцены: у каждого элемента сцены (`fullscreen`, `list`, `stat`, `action`, `chat`, `sticker`, `custom`, клипы) есть сцена в `scenes.json` с `show`, `adds`, `device`; есть `thread`.
- Текст: на экране сцены не больше 10 слов; фраза из 3+ смысловых слов, которую автор говорит в это же время (±1,5 с), — пересказ. Кириллические строки в `custom/*.tsx` (литералы и текст JSX) должны быть перечислены в `text` сцены.
- Разнообразие: один шаблон (`action`, `fullscreen`, `list`, `stat`) не больше чем в половине сцен и не три раза подряд.
- Перенос: полноэкранные сцены встык (зазор меньше 0,6 с) — `carry` или один элемент на обе сцены. Сам стык проверяет `cutroom gfx review` по кадрам: от последнего кадра сцены в первом кадре следующей должно остаться от 40%, иначе это стык-слайд и ошибка.
- Ритм: при 5+ сценах одинаковые длины — предупреждение.
- Рисунки: компонент с именем персонажа или предмета (robot, person, cat…) и 8+ фигурами SVG — ошибка; больше 70 фигур в компоненте — предупреждение.
- `critique.md` обязателен, если есть сцены.

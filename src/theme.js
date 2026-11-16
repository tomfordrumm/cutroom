// Theme and captions settings, shared by graphics.json and taste packs.
export const THEME_COLORS = ["accent", "accentForeground", "background", "foreground", "card", "cardForeground"];
export const THEME_FONTS = ["font", "displayFont", "captionFont"];
export const CAPTION_STYLES = ["pill", "plain", "off"];
export const CAPTION_POSITIONS = ["bottom", "center", "auto"];
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT = /^[\p{L}\p{N} ._-]{1,60}$/u;

/** Valid theme keys of `raw`; problems are pushed with the given prefix. */
export function validateTheme(raw, problems, where = "theme") {
  const theme = {};
  if (raw === undefined || raw === null) return theme;
  if (typeof raw !== "object" || Array.isArray(raw)) { problems.push(`${where}: объект.`); return theme; }
  for (const [key, value] of Object.entries(raw)) {
    if (key === "radius") {
      if (typeof value === "number" && value >= 0 && value <= 80) theme.radius = value;
      else problems.push(`${where}.radius: число от 0 до 80.`);
    } else if (THEME_COLORS.includes(key)) {
      if (typeof value === "string" && COLOR.test(value)) theme[key] = value;
      else problems.push(`${where}.${key}: цвет в формате #rrggbb.`);
    } else if (THEME_FONTS.includes(key)) {
      if (typeof value === "string" && FONT.test(value)) theme[key] = value;
      else problems.push(`${where}.${key}: название шрифта.`);
    } else problems.push(`${where}.${key}: неизвестный ключ (есть ${[...THEME_COLORS, ...THEME_FONTS, "radius"].join(", ")}).`);
  }
  return theme;
}

/** Captions settings over `base` (pack defaults); returns only valid fields. */
export function validateCaptions(raw, problems, where = "captions") {
  const result = {};
  if (raw === undefined || raw === null) return result;
  if (typeof raw !== "object" || Array.isArray(raw)) { problems.push(`${where}: объект.`); return result; }
  if (raw.style !== undefined) {
    if (CAPTION_STYLES.includes(raw.style)) result.style = raw.style;
    else problems.push(`${where}.style: ${CAPTION_STYLES.join(", ")}.`);
  }
  if (raw.position !== undefined) {
    if (CAPTION_POSITIONS.includes(raw.position)) result.position = raw.position;
    else problems.push(`${where}.position: ${CAPTION_POSITIONS.join(", ")}.`);
  }
  if (raw.wordsPerPage !== undefined) {
    if (Number.isInteger(raw.wordsPerPage) && raw.wordsPerPage >= 1 && raw.wordsPerPage <= 8) result.wordsPerPage = raw.wordsPerPage;
    else problems.push(`${where}.wordsPerPage: целое от 1 до 8.`);
  }
  if (raw.uppercase !== undefined) result.uppercase = raw.uppercase === true;
  for (const key of Object.keys(raw)) {
    if (!["style", "position", "wordsPerPage", "uppercase"].includes(key)) problems.push(`${where}.${key}: неизвестный ключ.`);
  }
  return result;
}

export const CAPTIONS_DEFAULTS = { style: "pill", position: "bottom", wordsPerPage: 4, uppercase: false };

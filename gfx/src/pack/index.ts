// The version's taste pack, filled in at bundle time from <version>/pack:
// info.json (theme, captions, replaced built-ins, fonts), fonts.css and components/.
import "./fonts.css"
import type { CaptionsProps } from "../components/Captions"
import type { CaptionsSettings, OverlayProps, Theme } from "../types"
import info from "./info.json"

export type PackInfo = {
  id: string
  name: string
  version: string
  theme: Partial<Theme>
  captions: Partial<CaptionsSettings> | null
  /** Built-in type (or "captions") → pack component name. */
  replaces: Record<string, string>
  fonts: { family: string; weight: string | number; style: string }[]
  /** Components that cover the whole frame (captions switch to the graphic backdrop over them). */
  fullFrame?: string[]
}

export const PACK = info as PackInfo

declare const require: { context: (dir: string, deep: boolean, pattern: RegExp) => { keys: () => string[]; (key: string): { default: React.ComponentType<never> } } }
const context = require.context("./components", false, /\.tsx$/)
export const PACK_COMPONENTS: Record<string, React.ComponentType<OverlayProps>> = Object.fromEntries(
  context.keys().map((key) => [key.replace(/^\.\//, "").replace(/\.tsx$/, ""), context(key).default as React.ComponentType<OverlayProps>]),
)
export const PACK_CAPTIONS = PACK.replaces.captions ? (PACK_COMPONENTS[PACK.replaces.captions] as unknown as React.ComponentType<CaptionsProps>) : null

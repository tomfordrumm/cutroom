// Library of ready scenes and marks, adapted from remocn (MIT, see LICENSE-remocn.md).
// Unlike the interface kit, these keep their own choreography: give them `at`
// (the element frame they start on) and the data; colours and fonts come from the theme.
export { ShareDonut, type DonutSegment, type ShareDonutProps } from "./ShareDonut"
export { BeforeAfter, type BeforeAfterProps } from "./BeforeAfter"
export { StrikeReplace, type StrikeReplaceProps } from "./StrikeReplace"
export { InkArrow, type InkArrowProps } from "./InkArrow"
export { ShotClock, type ShotClockProps } from "./ShotClock"
export { ExplodedView, type ExplodedViewProps } from "./ExplodedView"
export { whipPan, type Direction, type SceneStyles } from "./transitions"

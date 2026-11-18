// Library of ready scenes and marks, adapted from remocn (MIT, see LICENSE-remocn.md).
// Unlike the interface kit, these keep their own choreography: give them `at`
// (the element frame they start on) and the data; colours and fonts come from the theme.
export { ShareDonut, type DonutSegment, type ShareDonutProps } from "./ShareDonut"
export { BeforeAfter, type BeforeAfterProps } from "./BeforeAfter"
export { StrikeReplace, type StrikeReplaceProps } from "./StrikeReplace"
export { InkArrow, type InkArrowProps } from "./InkArrow"
export { ShotClock, type ShotClockProps } from "./ShotClock"
export { ExplodedView, type ExplodedViewProps } from "./ExplodedView"
export { Transition, whipPan, type Direction, type SceneStyles, type TransitionKind, type TransitionProps } from "./transitions"
export { Marker, InkUnderline, ScribbleCircle, Handwrite, handwriteFrames, CheckList, HAND_FONT, type CheckListProps, type HandwriteProps, type MarkerProps } from "./marks"
export { Steps, Quote, HookPunch, Pov, Acronym, type AcronymProps, type HookPunchProps, type PovProps, type QuoteProps, type StepsProps } from "./textScenes"
export { ActivityRings, BarChart, LineChart, SlopeChart, UnitGrid, Fraction, StackedBar, Waterfall, Radar, Tally, Stats, formatNumber, type Bar, type Ring, type SlopeLine, type Stat } from "./charts"
export { Versus, BalanceBeam, Flows, Venn, type VersusRow } from "./compare"
export { Countdown, ClockSweep, Calendar } from "./time"
export { GridMontage, Polaroid, UpClose, Tour, SplitScreen, type TourStop } from "./media"
export { Impact, Turntable, Confetti, Crumple, ComicPanels, Blueprint } from "./effects"
export { Booking, Streak } from "./appScenes"

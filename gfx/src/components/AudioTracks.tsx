// Music and sound effects. The music bed ducks under speech: `volume` while
// the author talks, `pauseVolume` in pauses longer than ~0.8 s.
import { useMemo } from "react"
import { Audio, interpolate, Sequence } from "remotion"
import { clamp } from "../motion"
import type { AudioTrack, Word } from "../types"

const LEAD = 0.15
const TAIL = 0.35
const BRIDGE = 0.8
const RAMP = 0.3

/** Speech intervals in seconds: words padded and short gaps bridged. */
function speechIntervals(words: Word[]) {
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const out: [number, number][] = []
  for (const w of sorted) {
    const start = w.start - LEAD
    const end = w.end + TAIL
    const last = out.at(-1)
    if (last && start - last[1] < BRIDGE) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}

/** 0 in speech, rising to 1 within RAMP seconds of the nearest speech edge. */
function pauseAmount(t: number, intervals: [number, number][]) {
  let distance = Infinity
  for (const [start, end] of intervals) {
    if (t >= start && t <= end) return 0
    distance = Math.min(distance, Math.abs(t - start), Math.abs(t - end))
    if (start > t + RAMP) break
  }
  return Math.min(1, distance / RAMP)
}

export function AudioTracks({ tracks, words, fps }: { tracks: AudioTrack[]; words: Word[]; fps: number }) {
  const intervals = useMemo(() => speechIntervals(words), [words])
  return (
    <>
      {tracks.map((track) => {
        const length = Math.max(1, track.to - track.from)
        const fadeIn = Math.max(1, Math.round((track.fadeIn ?? 0) * fps))
        const fadeOut = Math.max(1, Math.round((track.fadeOut ?? 0) * fps))
        const volume = (f: number) => {
          const envelope = Math.min(interpolate(f, [0, fadeIn], [0, 1], clamp), interpolate(f, [length - fadeOut, length], [1, 0], clamp))
          if (track.type === "sfx") return track.volume * envelope
          const pause = pauseAmount((track.from + f) / fps, intervals)
          return (track.volume + ((track.pauseVolume ?? track.volume) - track.volume) * pause) * envelope
        }
        return (
          <Sequence key={track.id} from={track.from} durationInFrames={length} layout="none">
            <Audio src={track.src} volume={volume} trimBefore={Math.round((track.offset ?? 0) * fps)} loop={track.loop} />
          </Sequence>
        )
      })}
    </>
  )
}

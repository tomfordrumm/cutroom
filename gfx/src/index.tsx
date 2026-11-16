import "@fontsource-variable/inter"
import { Composition, registerRoot } from "remotion"
import { defaultProps, Main } from "./Main"
import type { MainProps } from "./types"

function Root() {
  return (
    <Composition
      id="Cutroom"
      component={Main}
      defaultProps={defaultProps}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      calculateMetadata={({ props }: { props: MainProps }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: Math.max(1, props.durationInFrames),
      })}
    />
  )
}

registerRoot(Root)

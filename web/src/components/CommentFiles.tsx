import { FileAudio, FileVideo, X } from "lucide-react"
import { assetUrl } from "@/lib/api"
import { cn } from "@/lib/utils"

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

/** One file of a comment: a thumbnail for a picture, an icon for a clip or sound. */
function FileChip({ name, href, preview, onRemove, className }: { name: string; href?: string; preview?: string; onRemove?: () => void; className?: string }) {
  const Icon = AUDIO.test(name) ? FileAudio : FileVideo
  const body = (
    <>
      {IMAGE.test(name) && preview ? (
        <img src={preview} alt="" className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <Icon className="size-4 shrink-0 opacity-70" />
      )}
      <span className="min-w-0 truncate">{name}</span>
    </>
  )
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background/60 py-0.5 pr-1.5 pl-1 text-xs text-foreground", className)}>
      {href ? <a href={href} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-1.5 hover:underline">{body}</a> : body}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Убрать ${name}`} className="shrink-0 rounded text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
    </span>
  )
}

/** Files already attached to a saved comment, served from the video's materials. */
export function CommentFiles({ videoId, names, className }: { videoId: number; names: string[]; className?: string }) {
  if (!names.length) return null
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {names.map((name) => <FileChip key={name} name={name} href={assetUrl(videoId, name)} preview={assetUrl(videoId, name)} />)}
    </div>
  )
}

/** Files picked in the composer, not uploaded yet. */
export function PickedFiles({ files, onRemove }: { files: { file: File; preview: string }[]; onRemove: (index: number) => void }) {
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {files.map(({ file, preview }, index) => (
        <FileChip key={`${file.name}-${index}`} name={file.name} preview={preview} onRemove={() => onRemove(index)} />
      ))}
    </div>
  )
}

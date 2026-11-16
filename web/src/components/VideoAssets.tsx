import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MEDIA_ACCEPT, MediaRow, UploadArea, useUploads } from "@/components/MediaFiles"
import { api, type MediaFile, type VideoDetail } from "@/lib/api"

/** Materials attached to one video: pictures, clips and audio the edit may use. */
export function VideoAssets({ video }: { video: VideoDetail }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["video", video.id] })
  const uploads = useUploads((file) => `/api/videos/${video.id}/assets?name=${encodeURIComponent(file.name)}`, refresh)
  const remove = async (name: string) => {
    try {
      await api<{ assets: MediaFile[] }>(`/api/videos/${video.id}/assets/${encodeURIComponent(name)}`, { method: "DELETE" })
      await refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <div className="grid gap-2">
      <UploadArea
        accept={MEDIA_ACCEPT.any}
        onFiles={uploads.send}
        state={uploads.state}
        label="Картинки, видеовставки, звук для этого ролика. Где их показать — напишите в брифе или правке."
      />
      {video.assets.length > 0 && (
        <div className="grid divide-y rounded-lg border">
          {video.assets.map((file) => (
            <MediaRow key={file.name} file={file} src={`/media/videos/${video.id}/assets/${encodeURIComponent(file.name)}`} onDelete={() => remove(file.name)} />
          ))}
        </div>
      )}
    </div>
  )
}

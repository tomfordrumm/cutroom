import { AlertCircle, Loader2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { Job } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Live line for a queued, running or failed job. Renders nothing otherwise. */
export function JobStatus({ job, className }: { job: Job | null | undefined; className?: string }) {
  if (!job) return null
  if (job.status === "failed") {
    return (
      <div className={cn("flex gap-2 text-sm text-destructive", className)}>
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{job.error}</span>
      </div>
    )
  }
  if (job.status !== "queued" && job.status !== "running") return null
  return (
    <div className={cn("grid gap-2 text-sm text-muted-foreground", className)}>
      <div className="flex items-start gap-2">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{job.status === "queued" ? "В очереди" : job.step ?? "Работаю"}</span>
      </div>
      {job.status === "running" && job.progress != null && <Progress value={job.progress} className="h-1" />}
    </div>
  )
}

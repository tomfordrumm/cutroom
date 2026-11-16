import { cn } from "@/lib/utils"
import React from "react"

// prompt-kit's code block without syntax highlighting: agent replies rarely
// contain code, and shiki would add megabytes to the bundle.
export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn("not-prose flex w-full flex-col overflow-clip rounded-xl border border-border bg-card text-card-foreground", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({ code, language: _language, theme: _theme, className, ...props }: CodeBlockCodeProps) {
  return (
    <div className={cn("w-full overflow-x-auto px-4 py-3 font-mono text-[13px]", className)} {...props}>
      <pre><code>{code}</code></pre>
    </div>
  )
}

function CodeBlockGroup({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between", className)} {...props}>{children}</div>
}

export { CodeBlock, CodeBlockCode, CodeBlockGroup }

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { Copy, ExternalLink, SquareTerminal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* plain http on a server address has no Clipboard API */
  }
  const area = document.createElement("textarea")
  area.value = text
  area.style.cssText = "position:fixed;opacity:0"
  document.body.append(area)
  area.select()
  document.execCommand("copy")
  area.remove()
}

function TerminalSession() {
  const boxRef = useRef<HTMLDivElement>(null)
  const [link, setLink] = useState<string | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0a0a0a" },
      // OSC 8 hyperlinks carry the whole URL even when the visible text is
      // broken over lines (Claude Code prints its sign-in link that way).
      linkHandler: { activate: (_event, uri) => window.open(uri, "_blank", "noopener"), allowNonHttpProtocols: false },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(boxRef.current!)
    fit.fit()

    let lastLink = ""
    term.parser.registerOscHandler(8, (data) => {
      const uri = data.slice(data.indexOf(";") + 1)
      if (/^https?:\/\//.test(uri) && uri !== lastLink) {
        lastLink = uri
        setLink(uri)
      }
      return false
    })
    // OSC 52: programs in the terminal (Claude Code's "c to copy") set the clipboard.
    term.parser.registerOscHandler(52, (data) => {
      const payload = data.slice(data.indexOf(";") + 1)
      if (payload && payload !== "?") {
        try {
          const text = new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
          copyText(text).then(() => toast.success("Скопировано из терминала"))
        } catch {
          /* not base64 */
        }
      }
      return true
    })

    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/terminal`)
    const sendSize = () => ws.readyState === WebSocket.OPEN && ws.send(`\u0000resize:${term.cols}x${term.rows}`)
    ws.onopen = () => {
      sendSize()
      term.focus()
    }
    ws.onmessage = (event) => term.write(event.data)
    ws.onclose = () => term.write("\r\n[соединение закрыто]\r\n")
    const input = term.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(data))
    const observer = new ResizeObserver(() => {
      fit.fit()
      sendSize()
    })
    observer.observe(boxRef.current!)
    return () => {
      observer.disconnect()
      input.dispose()
      ws.close()
      term.dispose()
    }
  }, [])

  return (
    <div className="grid gap-2">
      <div ref={boxRef} className="h-[340px] overflow-hidden rounded-lg bg-[#0a0a0a] p-2" />
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
          <span className="mr-auto text-sm text-muted-foreground">Ссылка из терминала · {new URL(link).host}</span>
          <Button asChild size="sm">
            <a href={link} target="_blank" rel="noopener">
              <ExternalLink /> Открыть
            </a>
          </Button>
          <Button size="sm" variant="outline" onClick={() => copyText(link).then(() => toast.success("Ссылка скопирована"))}>
            <Copy /> Копировать
          </Button>
        </div>
      )}
    </div>
  )
}

/** Browser terminal into the Cutroom server, opened on demand. */
export function WebTerminal() {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SquareTerminal /> Открыть терминал
      </Button>
    )
  }
  return <TerminalSession />
}

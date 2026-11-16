// Browser terminal into the app container, for `claude` / `codex login`.
// The agents store their own sign-in under HOME (/data/home), which the worker
// shares; Cutroom only relays keystrokes and never reads those files.
import pty from "node-pty";
import { WebSocketServer } from "ws";
import { config } from "./config.js";

export function attachTerminal(server, { isAuthenticated }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname !== "/terminal" || !isAuthenticated(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws) => {
    const shell = pty.spawn("bash", ["-l"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: config.paths.home,
      env: { ...process.env, TERM: "xterm-256color", PS1: "cutroom:\\w$ " },
    });
    shell.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
    shell.onExit(() => ws.close());
    ws.on("message", (raw) => {
      const text = raw.toString("utf8");
      if (text.startsWith("\u0000resize:")) {
        const [cols, rows] = text.slice(8).split("x").map(Number);
        if (cols > 0 && rows > 0) shell.resize(cols, rows);
        return;
      }
      shell.write(text);
    });
    ws.on("close", () => { try { shell.kill(); } catch { /* already gone */ } });
  });
}

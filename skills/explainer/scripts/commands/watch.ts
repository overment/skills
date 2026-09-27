import { watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildPage, errorPage } from "../engine/page.ts";
import type { CommandRun, Mode } from "../engine/types.ts";
import { usage } from "../lib/commands.ts";
import { formatDiagnostic, isMode, relPath } from "./build.ts";

const USAGE = usage("watch");
const RELOAD = `<script>new EventSource("/__events").onmessage=()=>location.reload()</script>`;

export const run: CommandRun = async (argv) => {
  let values: { port?: string; theme?: string; mode?: string; "no-open"?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { port: { type: "string" }, theme: { type: "string" }, mode: { type: "string" }, "no-open": { type: "boolean" } },
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const port = Number(values.port ?? 4646);
  if (positionals.length !== 1 || !isMode(values.mode) || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(USAGE);
    return 2;
  }
  const doc = resolve(positionals[0]);
  if (!(await Bun.file(doc).exists())) {
    console.error(`explainer watch: ${positionals[0]} does not exist.`);
    return 1;
  }
  const opts = { theme: values.theme, mode: values.mode as Mode | undefined };
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let page = "";

  const rebuild = async () => {
    const started = performance.now();
    try {
      const { html, diagnostics } = await buildPage(doc, opts);
      page = withReload(html);
      console.log(`${clock()} built ${relPath(doc)} · ${Math.round(performance.now() - started)} ms`);
      for (const d of diagnostics) console.log(`  ${formatDiagnostic(relPath(doc), d)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      page = withReload(errorPage(basename(doc), [{ rule: "spec", severity: "error", message }]));
      console.error(`${clock()} build failed: ${message}`);
    }
    for (const c of clients) {
      try {
        c.enqueue(encoder.encode("data: reload\n\n"));
      } catch {
        clients.delete(c);
      }
    }
  };

  let queue = rebuild();
  await queue;

  const events = () => {
    let self: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        self = c;
        clients.add(c);
        c.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        clients.delete(self);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  };

  const server = listen(port, (req) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/__events") return events();
    if (pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return new Response("Not found", { status: 404 });
  });
  if (!server) {
    console.error(`explainer watch: ports ${port}–${port + 10} are all in use; pass --port.`);
    return 1;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dirname(doc), (_event, name) => {
    const file = name ? String(name) : "";
    if (file && file !== basename(doc) && !file.endsWith(".json")) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      queue = queue.then(rebuild);
    }, 50);
  });

  const url = server.url.href;
  console.log(`watching ${relPath(doc)} → ${url}  (Ctrl-C to stop)`);
  if (!values["no-open"]) openBrowser(url);

  return new Promise<number>((done) => {
    const stop = () => {
      clearTimeout(timer);
      watcher.close();
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
      server.stop(true);
      done(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
};

function listen(port: number, fetch: (req: Request) => Response): ReturnType<typeof Bun.serve> | undefined {
  for (let p = port; p <= port + 10; p++) {
    try {
      return Bun.serve({ port: p, hostname: "127.0.0.1", idleTimeout: 0, fetch });
    } catch (e) {
      if ((e as { code?: string }).code !== "EADDRINUSE") throw e;
    }
  }
}

function withReload(html: string): string {
  const at = html.lastIndexOf("</body>");
  return at < 0 ? html + RELOAD : html.slice(0, at) + RELOAD + html.slice(at);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No opener available; the URL is already printed.
  }
}

const clock = () => new Date().toTimeString().slice(0, 8);

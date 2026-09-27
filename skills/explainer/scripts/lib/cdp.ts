import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const COMMAND_TIMEOUT = 30_000;
const LAUNCH_TIMEOUT = 15_000;

type Handler = (params: any, sessionId?: string) => void;
interface Pending { method: string; resolve(value: any): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> }
export interface Clip { x: number; y: number; width: number; height: number }

export function findChrome(): string {
  const tried: string[] = [];
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    tried.push(`CHROME_PATH=${fromEnv}`);
  }
  if (process.platform === "darwin") {
    const bundles = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Chromium.app/Contents/MacOS/Chromium",
      "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ];
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      for (const bundle of bundles) {
        const path = join(root, bundle);
        if (existsSync(path)) return path;
        tried.push(path);
      }
    }
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const path = Bun.which(name);
    if (path) return path;
    tried.push(`${name} on PATH`);
  }
  throw new Error(`Chrome not found. Tried:\n  ${tried.join("\n  ")}\nInstall Chrome or set CHROME_PATH to its executable.`);
}

export function chromeAvailable(): boolean {
  try {
    findChrome();
    return true;
  } catch {
    return false;
  }
}

export async function launchChrome(opts: { headless?: boolean } = {}): Promise<Browser> {
  const executable = findChrome();
  const profile = mkdtempSync(join(tmpdir(), "explainer-chrome-"));
  let proc: Subprocess | undefined;
  // Registered before the spawn, so Ctrl-C during startup still kills Chrome and removes the profile.
  const release = onCleanup(() => {
    proc?.kill("SIGKILL");
    removeDirSync(profile);
  });
  try {
    proc = Bun.spawn(
      [
        executable,
        ...(opts.headless === false ? [] : ["--headless=new"]),
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        "--disable-gpu",
        "--mute-audio",
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
    );
    const endpoint = await devtoolsEndpoint(proc.stderr as ReadableStream<Uint8Array>);
    return new Browser(proc, await connect(endpoint), profile, release);
  } catch (err) {
    proc?.kill("SIGKILL");
    await proc?.exited;
    await removeDir(profile);
    release();
    throw err;
  }
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchChrome();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function devtoolsEndpoint(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let log = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), LAUNCH_TIMEOUT);
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === "timeout") throw new Error(`Chrome did not open DevTools within ${LAUNCH_TIMEOUT / 1000}s.${tail(log)}`);
      if (chunk.done) throw new Error(`Chrome exited during startup.${tail(log)}`);
      log += decoder.decode(chunk.value, { stream: true });
      const endpoint = log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (endpoint) {
        drain(reader);
        return endpoint;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

const tail = (log: string) => (log.trim() ? `\n${log.trim().split("\n").slice(-5).join("\n")}` : "");

// Keep reading stderr so Chrome never blocks on a full pipe.
function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
  void (async () => {
    try {
      while (!(await reader.read()).done);
    } catch {}
  })();
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`Could not connect to Chrome DevTools at ${url}`));
  });
}

async function removeDir(dir: string) {
  for (let attempt = 0; attempt < 5 && existsSync(dir); attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      await Bun.sleep(100);
    }
  }
}

// Chrome may still be writing to the profile for a moment after SIGKILL, so retry.
function removeDirSync(dir: string) {
  for (let attempt = 0; attempt < 10 && existsSync(dir); attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      Bun.sleepSync(50);
    }
  }
}

// ---------- cleanup on exit and on signals ----------

const cleanups = new Set<() => void>();
const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
let trapped = false;

function runCleanups() {
  for (const fn of [...cleanups]) {
    cleanups.delete(fn);
    try {
      fn();
    } catch {}
  }
}

function onSignal(signal: keyof typeof SIGNALS) {
  runCleanups();
  process.exit(SIGNALS[signal]);
}

/**
 * Runs `fn` (synchronously) if the process exits or gets SIGINT, SIGTERM or SIGHUP before the
 * returned `release` is called. Without this, Ctrl-C during shot/audit/gallery leaves a headless
 * Chrome running and its temporary profile on disk. The signal handlers are installed only while
 * something is registered, so commands that never start Chrome keep the default behaviour.
 */
export function onCleanup(fn: () => void): () => void {
  cleanups.add(fn);
  if (!trapped) {
    trapped = true;
    process.on("exit", runCleanups);
    for (const signal of Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]) process.on(signal, onSignal);
  }
  return () => {
    cleanups.delete(fn);
    if (cleanups.size || !trapped) return;
    trapped = false;
    process.off("exit", runCleanups);
    for (const signal of Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]) process.off(signal, onSignal);
  };
}

export class Browser {
  readonly profile: string;
  #proc: Subprocess;
  #ws: WebSocket;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, Set<Handler>>();
  #closed = false;
  #release: () => void;

  constructor(proc: Subprocess, ws: WebSocket, profile: string, release: () => void) {
    this.#proc = proc;
    this.#ws = ws;
    this.profile = profile;
    this.#release = release;
    ws.onmessage = (event) => this.#receive(String(event.data));
    ws.onclose = () => this.#failAll(new Error("Chrome closed the DevTools connection"));
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(`Browser is closed (${method})`));
    const id = ++this.#nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${COMMAND_TIMEOUT / 1000}s`));
      }, COMMAND_TIMEOUT);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(event: string, handler: Handler): () => void {
    let set = this.#handlers.get(event);
    if (!set) this.#handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  async newPage(): Promise<Page> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable"].map((method) => page.send(method)));
    return page;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await Promise.race([this.send("Browser.close").catch(() => {}), Bun.sleep(2000)]);
      this.#closed = true;
      this.#ws.close();
      const exited = await Promise.race([this.#proc.exited.then(() => true), Bun.sleep(3000).then(() => false)]);
      if (!exited) {
        this.#proc.kill("SIGKILL");
        await this.#proc.exited;
      }
    } catch {
      this.#proc.kill("SIGKILL");
    } finally {
      this.#closed = true;
      this.#failAll(new Error("Browser closed"));
      await removeDir(this.profile);
      this.#release();
    }
  }

  #receive(data: string) {
    const msg = JSON.parse(data);
    if (typeof msg.id === "number") {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
      else pending.resolve(msg.result ?? {});
      return;
    }
    for (const handler of this.#handlers.get(msg.method) ?? []) handler(msg.params ?? {}, msg.sessionId);
  }

  #failAll(err: Error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.#pending.clear();
  }
}

export class Page {
  readonly browser: Browser;
  readonly sessionId: string;
  readonly targetId: string;
  #errors: string[] = [];

  constructor(browser: Browser, sessionId: string, targetId: string) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.#on("Runtime.consoleAPICalled", (p) => {
      if (p.type !== "error" && p.type !== "warning") return;
      const text = (p.args ?? []).map((a: any) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(" ");
      this.#errors.push(`console.${p.type === "warning" ? "warn" : "error"}: ${text}`);
    });
    this.#on("Runtime.exceptionThrown", (p) => {
      const details = p.exceptionDetails ?? {};
      this.#errors.push(`uncaught: ${details.exception?.description ?? details.text}`);
    });
    this.#on("Log.entryAdded", (p) => {
      if (p.entry?.level === "error") this.#errors.push(`${p.entry.source}: ${p.entry.text}`);
    });
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.browser.send<T>(method, params, this.sessionId);
  }

  async goto(url: string): Promise<void> {
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loaded = new Promise<void>((resolve, reject) => {
      off = this.#on("Page.loadEventFired", () => resolve());
      timer = setTimeout(() => reject(new Error(`Timed out after ${COMMAND_TIMEOUT / 1000}s loading ${url}`)), COMMAND_TIMEOUT);
    });
    try {
      const { errorText } = await this.send("Page.navigate", { url });
      if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
      await loaded;
    } finally {
      off();
      clearTimeout(timer);
    }
  }

  setViewport({ width, height, scale = 1 }: { width: number; height: number; scale?: number }): Promise<void> {
    return this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(`Page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result?.value as T;
  }

  /** Run a self-contained function in the page. It must not close over anything outside its body. */
  call<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>> {
    return this.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a ?? null)).join(", ")})`);
  }

  async waitFor(expression: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await this.evaluate<boolean>(`Boolean(${expression})`))) {
      if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${expression}`);
      await Bun.sleep(50);
    }
  }

  async screenshot(opts: { clip?: Clip; fullPage?: boolean } = {}): Promise<Uint8Array> {
    let clip = opts.clip;
    if (!clip && opts.fullPage) {
      const { cssContentSize: size } = await this.send("Page.getLayoutMetrics");
      clip = { x: 0, y: 0, width: size.width, height: size.height };
    }
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      ...(clip && { clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 } }),
    });
    return new Uint8Array(Buffer.from(data, "base64"));
  }

  consoleErrors(): string[] {
    return [...this.#errors];
  }

  setScriptDisabled(disabled: boolean): Promise<void> {
    return this.send("Emulation.setScriptExecutionDisabled", { value: disabled });
  }

  emulateMedia(features: Record<string, string>): Promise<void> {
    return this.send("Emulation.setEmulatedMedia", {
      features: Object.entries(features).map(([name, value]) => ({ name, value })),
    });
  }

  close(): Promise<void> {
    return this.browser.send("Target.closeTarget", { targetId: this.targetId });
  }

  #on(event: string, fn: (params: any) => void): () => void {
    return this.browser.on(event, (params, sessionId) => {
      if (sessionId === this.sessionId) fn(params);
    });
  }
}

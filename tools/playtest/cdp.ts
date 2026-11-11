import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface EvaluateResponse {
  result?: { type: string; value?: unknown; description?: string };
  exceptionDetails?: {
    text: string;
    exception?: { description?: string };
  };
}

export class Browser {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Set<(message: CdpMessage) => void>();
  private readersAttached = false;

  private constructor(
    readonly chrome: ChildProcess,
    private readonly profileDir: string,
    private readonly socket: WebSocket,
    private readonly targetId: string,
    private readonly port: number,
  ) {
    this.attachReaders();
  }

  static async launch(port: number, url: string): Promise<Browser> {
    const binary = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
    if (!binary) {
      throw new Error(
        "Chrome/Chromium not found. Set CHROME_PATH to a browser binary.",
      );
    }

    const profileDir = mkdtempSync(join(tmpdir(), "raycast-playtest-"));
    const chrome = spawn(
      binary,
      [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--hide-scrollbars",
        "--mute-audio",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );

    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // Browser is still starting.
      }
      await sleep(150);
    }
    if (!ready) {
      chrome.kill("SIGTERM");
      rmSync(profileDir, { recursive: true, force: true });
      throw new Error("Chrome did not expose its debugging port in time");
    }

    const targetResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT" },
    );
    if (!targetResponse.ok) {
      chrome.kill("SIGTERM");
      rmSync(profileDir, { recursive: true, force: true });
      throw new Error(`Could not open a debug target: ${targetResponse.status}`);
    }
    const target = (await targetResponse.json()) as {
      id: string;
      webSocketDebuggerUrl: string;
    };

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Could not connect to the Chrome debug socket")),
        { once: true },
      );
    });

    const browser = new Browser(chrome, profileDir, socket, target.id, port);
    // Headless Chrome only emits animation frames for a foregrounded target;
    // without this, rAF stalls seconds into a run and real-time checks freeze.
    await browser.send("Page.bringToFront");
    return browser;
  }

  private attachReaders(): void {
    if (this.readersAttached) return;
    this.readersAttached = true;
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  onMessage(listener: (message: CdpMessage) => void): void {
    this.listeners.add(listener);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise as Promise<T>;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<EvaluateResponse>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text;
      throw new Error(`Page evaluation failed: ${detail}`);
    }
    return response.result?.value as T;
  }

  async screenshot(path: string): Promise<void> {
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(path, Buffer.from(data, "base64"));
  }

  async close(): Promise<void> {
    try {
      await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`);
    } catch {
      // The browser may already be gone.
    }
    this.socket.close();
    this.chrome.kill("SIGTERM");
    await sleep(250);
    if (!this.chrome.killed) this.chrome.kill("SIGKILL");
    rmSync(this.profileDir, { recursive: true, force: true });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

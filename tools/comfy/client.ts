import { readFileSync } from "node:fs";
import { basename } from "node:path";

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

interface QueueResult {
  prompt_id: string;
  node_errors?: Record<string, unknown>;
}

interface HistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
}

export interface ComfyClientOptions {
  endpoint: string;
  timeoutMs: number;
  intervalMs?: number;
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export class ComfyClient {
  readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;

  constructor(options: ComfyClientOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.timeoutMs = options.timeoutMs;
    this.intervalMs = options.intervalMs ?? 750;
  }

  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/system_stats`, {
        signal: AbortSignal.timeout(4000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async uploadImage(path: string, name = basename(path)): Promise<ComfyImageRef> {
    const data = readFileSync(path);
    const form = new FormData();
    form.append("image", new Blob([data], { type: "image/png" }), name);
    form.append("name", name);
    form.append("overwrite", "true");
    form.append("type", "input");

    const response = await fetch(`${this.endpoint}/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`ComfyUI upload failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as {
      name?: string;
      subfolder?: string;
      type?: string;
    };
    return {
      filename: body.name ?? name,
      subfolder: body.subfolder ?? "",
      type: body.type ?? "input",
    };
  }

  async queue(workflow: Record<string, unknown>, clientId: string): Promise<string> {
    const response = await fetch(`${this.endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`ComfyUI queue failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as QueueResult;
    if (body.node_errors && Object.keys(body.node_errors).length > 0) {
      throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(body.node_errors)}`);
    }
    if (!body.prompt_id) {
      throw new Error("ComfyUI did not return a prompt_id");
    }
    return body.prompt_id;
  }

  async waitForImages(promptId: string): Promise<ComfyImageRef[]> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const response = await fetch(`${this.endpoint}/history/${promptId}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`ComfyUI history failed (${response.status}): ${await response.text()}`);
      }
      const body = (await response.json()) as Record<string, HistoryEntry>;
      const entry = body[promptId];
      if (entry) {
        const status = entry.status;
        if (status?.status_str === "error") {
          throw new Error(`ComfyUI execution failed: ${JSON.stringify(status.messages ?? [])}`);
        }
        const images = Object.values(entry.outputs ?? {}).flatMap(
          (output) => output.images ?? [],
        );
        if (images.length > 0) return images;
        if (status?.completed) {
          throw new Error("ComfyUI finished but produced no images");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }
    throw new Error(`ComfyUI prompt ${promptId} timed out after ${this.timeoutMs}ms`);
  }

  async downloadImage(image: ComfyImageRef): Promise<Buffer> {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const response = await fetch(`${this.endpoint}/view?${query}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`ComfyUI download failed (${response.status}): ${await response.text()}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

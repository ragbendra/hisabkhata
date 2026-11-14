import { db } from "./db";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {
  constructor() {
    super("Network unreachable");
  }
}

function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join("; ");
  }
  return "Request failed";
}

async function request(path: string, method: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "include",
      headers: {
        "X-Requested-With": "fruit-khata",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not JSON */
    }
    // A proxy or captive portal answering for the server is the same as being offline.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError();
    throw new ApiError(res.status, detailText(detail));
  }
  return res;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await request(path, opts.method ?? (opts.body !== undefined ? "POST" : "GET"), opts.body);
  return (await res.json()) as T;
}

export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const res = await request(path, "GET");
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^"]+)"?/.exec(cd);
  return { blob: await res.blob(), filename: m?.[1] ?? "Hisab.xlsx" };
}

/** GET with an IndexedDB fallback: offline, the screen shows what was last loaded (FR-34). */
export async function fetchWithCache<T>(cacheKey: string, path: string): Promise<T> {
  try {
    const data = await api<T>(path);
    await db.cache.put({ key: cacheKey, value: data, updatedAt: Date.now() });
    return data;
  } catch (e) {
    if (e instanceof NetworkError) {
      const row = await db.cache.get(cacheKey);
      if (row) return row.value as T;
    }
    throw e;
  }
}

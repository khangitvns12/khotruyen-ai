// ============================================================
// KhoTruyện AI — client-side fetch helper
// Mọi request đều dùng đường dẫn TƯƠNG ĐỐI (/api/...).
// Envelope: { ok: true, ...data } | { ok: false, error: string }
// ============================================================

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * Gửi fetch tới API nội bộ (relative path) và trả về JSON envelope.
 * Throw Error khi mạng lỗi hoặc `json.ok !== true`.
 */
export async function api<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError("Không kết nối được máy chủ")
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ApiError(`Lỗi HTTP ${res.status}`, res.status)
  }

  if (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    (json as { ok?: unknown }).ok !== true
  ) {
    const err = (json as { error?: unknown }).error
    throw new ApiError(
      typeof err === "string" && err ? err : "Lỗi không xác định",
      res.status
    )
  }

  return json as T
}

/** POST JSON tiện ích. */
export function post<T = Record<string, unknown>>(
  path: string,
  body?: unknown
): Promise<T> {
  return api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** PUT JSON tiện ích. */
export function put<T = Record<string, unknown>>(
  path: string,
  body?: unknown
): Promise<T> {
  return api<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** PATCH JSON tiện ích. */
export function patch<T = Record<string, unknown>>(
  path: string,
  body?: unknown
): Promise<T> {
  return api<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** DELETE tiện ích. */
export function del<T = Record<string, unknown>>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" })
}

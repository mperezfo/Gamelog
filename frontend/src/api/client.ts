/**
 * Typed HTTP client for the API.
 *
 * Every path is relative to `/api`: in development the Vite proxy forwards it
 * to the Go backend (see vite.config.ts), and in production the frontend is
 * served from the same origin as the API.
 *
 * The session is an `HttpOnly` cookie the backend sets, so there is no token
 * to attach here and nothing to keep in storage. Being the same origin is what
 * makes that work, and is why it is a rule of the project rather than a
 * convenience.
 */

/** Error for a response with an HTTP status outside the 2xx range. */
export class ApiError extends Error {
  readonly status: number
  readonly path: string

  constructor(status: number, path: string, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.path = path
  }

  /** Whether the request failed for want of a session. */
  get unauthorised(): boolean {
    return this.status === 401
  }
}

/**
 * Reads the explanation out of a failed response.
 *
 * The API answers errors as RFC 9457 problem details, whose `detail` is a
 * sentence written for a person. Anything else — a proxy's HTML error page,
 * say — falls back to naming the status, which is at least true.
 */
async function readError(response: Response, path: string): Promise<ApiError> {
  let detail = `${path} responded ${response.status}`
  try {
    const body = (await response.json()) as { detail?: string; title?: string }
    detail = body.detail ?? body.title ?? detail
  } catch {
    // Not JSON. The status is all there is to say.
  }
  return new ApiError(response.status, path, detail)
}

/** Performs a request and returns the typed JSON body. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // The default for a same-origin request, spelled out because the whole
    // session depends on it.
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init?.headers },
  })

  if (!response.ok) {
    throw await readError(response, path)
  }

  // Logging out and deleting answer 204, which has no body to parse.
  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/** Performs a request and returns the raw response body, for a binary
 * download such as a backup .zip. */
export async function apiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...init?.headers },
  })

  if (!response.ok) {
    throw await readError(response, path)
  }

  return response.blob()
}

/** Performs a request carrying a JSON body. */
export function apiSend<T>(path: string, method: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The sentence to show a person for a failed request. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
}

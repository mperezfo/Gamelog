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
 *
 * Every request also reports whether it reached the server, which is what
 * switches the app to its read-only offline mode (see lib/connectivity.ts).
 */

import { isOfflineSimulated, setServerReachable } from '../lib/connectivity'

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

/** Error for a request the API never answered: no network, the server
 * down, or the backend behind it down (the proxy then answers 502). */
export class UnreachableError extends Error {
  readonly path: string

  constructor(path: string) {
    super('The server cannot be reached.')
    this.name = 'UnreachableError'
    this.path = path
  }
}

/** What a proxy answers when what it fronts is not there, and what the API
 * itself answers when its database is not: nothing can be read or saved
 * either way. */
const UNAVAILABLE_STATUSES = new Set([502, 503, 504])

/** How long a request waits for the server to start answering. An
 * unreachable host often does not fail outright, it just never answers, and
 * the app should switch to offline before the person gives up on it. */
const RESPONSE_TIMEOUT_MS = 10_000

/** Performs a request, telling an unreachable server apart from any answer
 * it gave. */
async function send(path: string, init: RequestInit): Promise<Response> {
  if (import.meta.env.DEV && isOfflineSimulated()) {
    throw new UnreachableError(path)
  }

  // A timer cleared once the server answers, rather than
  // AbortSignal.timeout: aborting after that would cut off a long download.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // The default for a same-origin request, spelled out because the whole
      // session depends on it.
      credentials: 'same-origin',
      signal: controller.signal,
    })
  } catch {
    setServerReachable(false)
    throw new UnreachableError(path)
  } finally {
    clearTimeout(timer)
  }

  if (UNAVAILABLE_STATUSES.has(response.status)) {
    setServerReachable(false)
    throw new UnreachableError(path)
  }
  setServerReachable(true)
  return response
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
  const response = await send(path, {
    ...init,
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
  const response = await send(path, { ...init })

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

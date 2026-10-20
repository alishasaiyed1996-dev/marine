/**
 * Core API infrastructure for Alka Traders.
 *
 * Handles:
 * - Base URL resolution
 * - Auth token injection (admin JWT + customer JWT)
 * - Token refresh via httpOnly cookie flow
 * - CSRF double-submit pattern
 * - Consistent error handling
 * - Convenience methods (get/post/put/patch/del)
 */

const rawApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')
// '/api' is a legacy value (old dev proxy / old env files). The
// Hostinger frontend has no /api proxy, so that value would silently break
// every API call — fall back to the production API instead. An empty value is
// left untouched so the Vite dev-server proxy keeps working during local
// development. ⚠️ Don't set VITE_API_URL=/api in any env file: it silently
// routes to the production API. Use an empty value for local dev and the full
// https://api.alkatraders.co URL for production builds.
const apiUrl = rawApiUrl === '/api' ? 'https://api.alkatraders.co' : rawApiUrl
const API_BASE = apiUrl + '/api/v1'

// ─── Diagnostic Logging ─────────────────────────────────────────
// Console diagnostics for production triage. Every request that fails logs its
// URL, method, duration and failure CLASS, so a developer can tell from the
// browser console alone whether the problem is:
//   - 'network' → no HTTP response reached the browser: backend process down,
//                 unreachable, or CORS blocked the response
//   - 'http'    → the server DID respond with a status code (408/503/5xx):
//                 the backend is alive, the fault is inside the stack
// Set VITE_API_DEBUG=1 at build time to also log every successful request.
const DEBUG_REQUESTS = import.meta.env.VITE_API_DEBUG === '1'

console.info(`[api] API base: ${API_BASE}`)

async function timedFetch(path: string, init: RequestInit): Promise<Response> {
  const startedAt = Date.now()
  const method = init.method || 'GET'
  try {
    const res = await fetch(`${API_BASE}${path}`, init)
    const durationMs = Date.now() - startedAt
    if (DEBUG_REQUESTS) {
      console.info(`[api] ${method} ${path} -> ${res.status} (${durationMs}ms)`)
    } else if (res.status === 408 || res.status >= 500) {
      console.warn(`[api] HTTP ${res.status} ${method} ${path} (${durationMs}ms) — server responded; fault is inside the backend stack`)
    }
    return res
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.warn(
      `[api] NETWORK FAILURE ${method} ${path} (${durationMs}ms) — no HTTP response: backend down, unreachable, or CORS blocked`,
      err instanceof Error ? err.message : err,
    )
    throw err
  }
}

// ─── Token Storage (in-memory, NOT localStorage for security) ───

let adminAccessToken: string | null = null
let customerAccessToken: string | null = null

// ─── CSRF Token Cache ───────────────────────────────────────────
const CSRF_TOKEN_TTL_MS = 50 * 60 * 1000 // Refresh at 50 min (token expires at 60 min)
let csrfToken: string | null = null
let csrfTokenFetchedAt = 0
let csrfTokenPromise: Promise<string | null> | null = null

// Track ongoing refreshes to deduplicate concurrent 401 retries. Admin and
// customer sessions use different cookies/endpoints, so they must never share
// a promise — otherwise one role's successful refresh makes the other role
// retry with a token that was never refreshed.
let adminRefreshInProgress: Promise<RefreshResult> | null = null
let customerRefreshInProgress: Promise<RefreshResult> | null = null

async function getCsrfToken(): Promise<string | null> {
  // Return cached token if still fresh (refresh at 50 min, expires at 60 min)
  if (csrfToken && Date.now() - csrfTokenFetchedAt < CSRF_TOKEN_TTL_MS) return csrfToken

  // Deduplicate concurrent fetches
  if (csrfTokenPromise) return csrfTokenPromise

  csrfTokenPromise = (async () => {
    try {
      const res = await timedFetch('/csrf-token', {
        credentials: 'include',
      })
      if (!res.ok) return null
      const data = await res.json()
      csrfToken = data.csrfToken || null
      csrfTokenFetchedAt = Date.now()
      return csrfToken
    } catch {
      console.warn('[api] CSRF token fetch failed — continuing without CSRF protection')
      csrfTokenPromise = null
      return null
    } finally {
      csrfTokenPromise = null
    }
  })()

  return csrfTokenPromise
}

export function getAdminToken(): string | null {
  return adminAccessToken
}

export function getCustomerToken(): string | null {
  return customerAccessToken
}

export function setAdminToken(token: string | null) {
  adminAccessToken = token
}

export function setCustomerToken(token: string | null) {
  customerAccessToken = token
}

// ─── Core Fetch Wrapper ─────────────────────────────────────────

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: 'admin' | 'customer'
}

export class ApiError extends Error {
  status: number
  details?: { field: string; message: string }[]

  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    let details: { field: string; message: string }[] | undefined

    try {
      const json = await res.json()
      message = json.error || message
      details = json.details
    } catch {
      console.warn('[api] Non-JSON error response:', res.status, res.statusText)
    }

    throw new ApiError(res.status, message, details)
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T
  }

  // Only parse JSON if content-type indicates it
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return res.json() as Promise<T>
  }

  // For non-JSON (e.g. CSV, HTML), return text wrapped in a string type
  return res.text() as unknown as T
}

// ─── Token Refresh ──────────────────────────────────────────────

/** Result of a refresh attempt: renewed, definitively rejected, or temporarily unavailable. */
export type RefreshResult = 'ok' | 'invalid' | 'unavailable'

/**
 * Restore the in-memory admin access token from the httpOnly refresh cookie.
 * Used on page reload, when the in-memory token no longer exists.
 */
export async function refreshAdminSession(): Promise<RefreshResult> {
  return tryRefreshAdmin()
}

/**
 * Restore the in-memory customer access token from the httpOnly refresh cookie.
 * Used on page reload, when the in-memory token no longer exists.
 */
export async function refreshCustomerSession(): Promise<RefreshResult> {
  return tryRefreshCustomer()
}

async function tryRefreshAdmin(): Promise<RefreshResult> {
  try {
    const res = await timedFetch('/admin/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      adminAccessToken = null
      return res.status === 401 || res.status === 403 ? 'invalid' : 'unavailable'
    }
    const data = await res.json()
    adminAccessToken = data.accessToken
    return 'ok'
  } catch {
    console.warn('[api] Admin token refresh failed — session may expire soon')
    adminAccessToken = null
    return 'unavailable'
  }
}

async function tryRefreshCustomer(): Promise<RefreshResult> {
  try {
    const res = await timedFetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      customerAccessToken = null
      return res.status === 401 || res.status === 403 ? 'invalid' : 'unavailable'
    }
    const data = await res.json()
    customerAccessToken = data.accessToken
    return 'ok'
  } catch {
    console.warn('[api] Customer token refresh failed — session may expire soon')
    customerAccessToken = null
    return 'unavailable'
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { auth, body, headers: customHeaders, ...rest } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((customHeaders as Record<string, string>) || {}),
  }

  // Inject auth token
  if (auth === 'admin' && adminAccessToken) {
    headers['Authorization'] = `Bearer ${adminAccessToken}`
  } else if (auth === 'customer' && customerAccessToken) {
    headers['Authorization'] = `Bearer ${customerAccessToken}`
  }

  // Inject CSRF token on state-changing requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method || 'GET')) {
    const token = await getCsrfToken()
    if (token) {
      headers['X-CSRF-Token'] = token
    }
  }

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (body instanceof FormData) {
    delete headers['Content-Type']
  }

  const res = await timedFetch(path, {
    ...rest,
    headers,
    body: body instanceof FormData ? body : body != null ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  // Handle 401 — try token refresh (deduplicated)
  if (res.status === 401) {
    let refreshed = false
    if (auth === 'admin' && adminAccessToken) {
      if (!adminRefreshInProgress) {
        adminRefreshInProgress = tryRefreshAdmin().finally(() => { adminRefreshInProgress = null })
      }
      refreshed = (await adminRefreshInProgress) === 'ok'
    } else if (auth === 'customer' && customerAccessToken) {
      if (!customerRefreshInProgress) {
        customerRefreshInProgress = tryRefreshCustomer().finally(() => { customerRefreshInProgress = null })
      }
      refreshed = (await customerRefreshInProgress) === 'ok'
    }
    if (refreshed) {
      const token = auth === 'admin' ? adminAccessToken : customerAccessToken
      headers['Authorization'] = `Bearer ${token}`
      const retryHeaders: Record<string, string> = { ...headers }
      if (body instanceof FormData) {
        delete retryHeaders['Content-Type']
      }
      const retryRes = await timedFetch(path, {
        ...rest,
        headers: retryHeaders,
        body: body instanceof FormData ? body : body != null ? JSON.stringify(body) : undefined,
        credentials: 'include',
      })
      return handleResponse<T>(retryRes)
    }
  }

  return handleResponse<T>(res)
}

// ─── Convenience Methods ────────────────────────────────────────

export const api = {
  get: <T = unknown>(path: string, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...opts, method: 'GET' }),

  post: <T = unknown>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method'>) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),

  put: <T = unknown>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method'>) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', body }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method'>) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body }),

  del: <T = unknown>(path: string, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
}

export { API_BASE }

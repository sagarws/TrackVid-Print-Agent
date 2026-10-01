import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { clearSession, getToken } from '../auth/session'
import { appLog } from '../utils/appLog'

/**
 * The app's one API client — TrackVid-FE's `config/axios.ts`, for the agent.
 *
 *   base URL   `${VITE_APP_BASE_URL}/api`, the backend the web admin uses
 *   request    `Authorization: Bearer <token>` from the session
 *   401        the session is over: it is cleared and the app returns to the
 *              login page (see AuthProvider), wherever the call was made
 *   errors     rejected with an ApiError: `message` is the server's
 *              displayMessage (fit to show, as in the web admin), `detail` the
 *              server's own `message` (the real cause of a 500), and `status`
 *   logging    every call is logged — method, path, status, time, and for a
 *              failure the server's message — to the terminal and agent.log
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string | null
  ) {
    super(message)
  }
}

/** Never log a password or token, whatever endpoint carries it. */
const redact = (data: unknown): string => {
  if (!data || typeof data !== 'object') return ''
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const key of Object.keys(copy)) {
    if (/password|token|secret/i.test(key)) copy[key] = '***'
  }
  return JSON.stringify(copy).slice(0, 300)
}
export const API_BASE_URL = (import.meta.env.VITE_APP_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')

export const SERVER_AUTH_ERROR_STATUS_CODE = 401
export const SERVER_VALIDATION_STATUS_CODE = 400
export const GENERIC_ERROR_MESSAGE = 'Something went wrong! Please try again later.'

/** Fired on any 401, so the auth layer can log out and say why. */
export const SESSION_EXPIRED_EVENT = 'trackvid:session-expired'

const api = axios.create({ baseURL: `${API_BASE_URL}/api`, timeout: 30_000 })

const started = new WeakMap<object, number>()

api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  started.set(config, performance.now())
  return config
})

const describe = (config: { method?: string; url?: string } | undefined) =>
  `${(config?.method ?? 'get').toUpperCase()} ${config?.url ?? '?'}`

const took = (config: object | undefined) => {
  const start = config ? started.get(config) : undefined
  return start === undefined ? '' : ` (${Math.round(performance.now() - start)} ms)`
}

api.interceptors.response.use(
  (response: AxiosResponse) => {
    appLog('info', 'api', `${describe(response.config)} → ${response.status}${took(response.config)}`)
    return response
  },
  (error: AxiosError<{ displayMessage?: unknown; message?: string }>) => {
    if (!error.response) {
      const why = error.code === 'ECONNABORTED' ? 'timed out' : `no response (${error.code ?? error.message})`
      appLog('error', 'api', `${describe(error.config)} → ${why}${took(error.config)} — ${API_BASE_URL}`)
      return Promise.reject(
        new ApiError(
          error.code === 'ECONNABORTED'
            ? 'The server took too long to answer.'
            : `Could not reach TrackVid (${API_BASE_URL}). Check the connection.`,
          null,
          error.message
        )
      )
    }
    const { status, data } = error.response
    appLog(
      status >= 500 ? 'error' : 'warn',
      'api',
      `${describe(error.config)} → ${status}${took(error.config)} — server message: ${JSON.stringify(data?.message ?? null)}, displayMessage: ${JSON.stringify(data?.displayMessage ?? null)}${error.config?.data && !String(error.config.url ?? '').startsWith('/auth') ? `, body: ${redact(typeof error.config.data === 'string' ? safeJson(error.config.data) : error.config.data)}` : ''}`
    )
    if (status === SERVER_AUTH_ERROR_STATUS_CODE && getToken()) {
      clearSession()
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    }
    const display = data?.displayMessage
    const message =
      typeof display === 'string' && display
        ? display
        : display && typeof display === 'object'
          ? Object.values(display as Record<string, unknown>).filter(v => typeof v === 'string').join(' ')
          : data?.message || GENERIC_ERROR_MESSAGE
    const detail = typeof data?.message === 'string' && data.message !== message ? data.message : null
    return Promise.reject(new ApiError(message || GENERIC_ERROR_MESSAGE, status, detail))
  }
)

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const get = <T = unknown>(url: string, config: AxiosRequestConfig = {}) => api.get<T>(url, config)
export const post = <T = unknown>(url: string, data: object = {}, config: AxiosRequestConfig = {}) =>
  api.post<T>(url, data, config)
export const put = <T = unknown>(url: string, data: object = {}, config: AxiosRequestConfig = {}) => api.put<T>(url, data, config)
export const patch = <T = unknown>(url: string, data: object = {}, config: AxiosRequestConfig = {}) =>
  api.patch<T>(url, data, config)
export const del = <T = unknown>(url: string, config: AxiosRequestConfig = {}) => api.delete<T>(url, config)

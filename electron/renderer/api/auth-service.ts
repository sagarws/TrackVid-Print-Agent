import { get, post } from './axios'
import type { SessionUser } from '../auth/session'

/** The backend's response envelope: `{ isSuccess, message, displayMessage, data }`. */
export interface ApiEnvelope<T> {
  isSuccess: boolean
  message?: string
  displayMessage?: string
  data: T
}

const URL = '/auth'

/** POST /api/auth/login — the web admin's login. */
const login = (payload: { email: string; password: string }) =>
  post<ApiEnvelope<{ accessToken: string; user: SessionUser }>>(`${URL}/login`, payload)

/** Ends this login on the server too, so a copied token stops working. */
const logout = () => post<ApiEnvelope<unknown>>(`${URL}/logout`, {}, { timeout: 5000 })

/** GET /api/user/get-user — confirms a stored session is still accepted. */
const getUser = () => get<ApiEnvelope<unknown>>('/user/get-user')

export const AuthService = { login, logout, getUser }

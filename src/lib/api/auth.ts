/**
 * Customer + Admin auth API endpoints.
 */

import { api } from './core'

// ─── Customer Auth ──────────────────────────────────────────────

export const customerAuth = {
  register: (data: { name: string; email: string; password: string; phone?: string; company?: string; country?: string }) =>
    api.post<{
      accessToken?: string
      user?: { id: string; name: string; email: string }
      /** Returned instead of tokens when the address cannot be used for a new account. */
      message?: string
    }>('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<{ accessToken: string; user: { id: string; name: string; email: string } }>('/auth/login', data),

  logout: () =>
    api.post<{ message: string }>('/auth/logout', undefined, { auth: 'customer' }),

  me: () =>
    api.get<{ user: { id: string; name: string; email: string; phone?: string; company?: string; country?: string } }>('/auth/me', { auth: 'customer' }),

  updateProfile: (data: { name?: string; phone?: string; company?: string; country?: string }) =>
    api.put<{ user: { id: string; name: string; email: string; phone?: string; company?: string; country?: string } }>('/auth/me', data, { auth: 'customer' }),

  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }),

  /**
   * Exchanges the emailed reset token for a short-lived ticket. The ticket is
   * kept in memory only; the token is stripped from the URL right after.
   */
  verifyResetToken: (token: string) =>
    api.post<{ ticket: string }>('/auth/reset-password/verify', { token }),

  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }),
}

// ─── Admin Auth ─────────────────────────────────────────────────

export const adminAuth = {
  login: (data: { email: string; password: string }) =>
    api.post<{ accessToken: string; user: { id: string; name: string; email: string; role: string; avatarUrl?: string } }>('/admin/auth/login', data),

  refresh: () =>
    api.post<{ accessToken: string }>('/admin/auth/refresh'),

  logout: () =>
    api.post<{ message: string }>('/admin/auth/logout', undefined, { auth: 'admin' }),

  me: () =>
    api.get<{ user: { id: string; name: string; email: string; role: string; avatarUrl?: string; lastLoginAt?: string } }>('/admin/auth/me', { auth: 'admin' }),
}

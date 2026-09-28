import type { DateFormat, GamesView, SetupStatus, Theme, User } from '../types/auth'
import { ApiError, apiFetch, apiSend } from './client'

/**
 * The account the session belongs to, or null when there is no session.
 *
 * A 401 is an answer rather than a failure here: it is how the application
 * learns to show the login screen. Anything else is a real error and is
 * rethrown.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<User>('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.unauthorised) {
      return null
    }
    throw error
  }
}

export function login(username: string, password: string): Promise<User> {
  return apiSend<User>('/auth/login', 'POST', { username, password })
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<User> {
  return apiSend<User>('/auth/password', 'PUT', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export function updateProfile(name: string, avatarUrl: string | null): Promise<User> {
  return apiSend<User>('/auth/profile', 'PUT', { name, avatar_url: avatarUrl })
}

export function updatePreferences(theme: Theme, dateFormat: DateFormat, gamesView: GamesView): Promise<User> {
  return apiSend<User>('/auth/preferences', 'PUT', { theme, date_format: dateFormat, games_view: gamesView })
}

export function getSetupStatus(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>('/setup')
}

/** Creates the admin account on a deployment that has none, and logs in as it. */
export function runSetup(password: string): Promise<User> {
  return apiSend<User>('/setup', 'POST', { password })
}

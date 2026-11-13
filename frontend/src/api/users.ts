import type { Account, User } from '../types/auth'
import { apiFetch, apiSend } from './client'

/** The admin's account management. Every call here needs an admin session. */

export function listUsers(): Promise<Account[]> {
  return apiFetch<Account[]>('/users')
}

export function createUser(username: string, password: string): Promise<User> {
  return apiSend<User>('/users', 'POST', { username, password })
}

export function deleteUser(id: number): Promise<void> {
  return apiFetch<void>(`/users/${id}`, { method: 'DELETE' })
}

export function resetUserPassword(id: number, password: string): Promise<void> {
  return apiSend<void>(`/users/${id}/password`, 'PUT', { password })
}

/** Lifts the lock failed logins put on an account, from every address. */
export function unlockUser(id: number): Promise<void> {
  return apiFetch<void>(`/users/${id}/lock`, { method: 'DELETE' })
}

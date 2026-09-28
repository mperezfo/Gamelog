import type { User } from '../types/auth'
import { apiFetch, apiSend } from './client'

/** The admin's account management. Every call here needs an admin session. */

export function listUsers(): Promise<User[]> {
  return apiFetch<User[]>('/users')
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

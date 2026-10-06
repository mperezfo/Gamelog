import type { NotificationChannel, NotificationChannelInput } from '../types/notifications'
import { apiFetch, apiSend } from './client'

/** The channels this deployment offers, each with the account's own setup. */
export function listNotificationChannels(): Promise<NotificationChannel[]> {
  return apiFetch<NotificationChannel[]>('/notifications/channels')
}

export function updateNotificationChannel(
  type: string,
  input: NotificationChannelInput,
): Promise<NotificationChannel> {
  return apiSend<NotificationChannel>(`/notifications/channels/${type}`, 'PUT', input)
}

/** Sends a message through the channel with the settings last saved. */
export function testNotificationChannel(type: string): Promise<void> {
  return apiFetch<void>(`/notifications/channels/${type}/test`, { method: 'POST' })
}

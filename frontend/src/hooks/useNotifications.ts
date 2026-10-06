import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  listNotificationChannels,
  testNotificationChannel,
  updateNotificationChannel,
} from '../api/notifications'
import type { NotificationChannel, NotificationChannelInput } from '../types/notifications'

const channelsKey = ['notification-channels'] as const

/** The notification channels on offer, with this account's setup for each. */
export function useNotificationChannels() {
  return useQuery({ queryKey: channelsKey, queryFn: listNotificationChannels })
}

/** Saves one channel and puts the answer straight into the list. */
export function useUpdateNotificationChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ type, input }: { type: string; input: NotificationChannelInput }) =>
      updateNotificationChannel(type, input),
    onSuccess: (saved) =>
      queryClient.setQueryData<NotificationChannel[]>(channelsKey, (channels) =>
        channels?.map((channel) => (channel.type === saved.type ? saved : channel)),
      ),
  })
}

export function useTestNotificationChannel() {
  return useMutation({ mutationFn: testNotificationChannel })
}

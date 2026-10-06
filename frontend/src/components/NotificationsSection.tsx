import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import {
  useNotificationChannels,
  useTestNotificationChannel,
  useUpdateNotificationChannel,
} from '../hooks/useNotifications'
import type { NotificationChannel } from '../types/notifications'
import { Button } from './Button'
import { Field } from './Field'
import { Notice } from './Notice'
import { Select } from './Select'

/** How far ahead of a release the reminder can be asked for. The API takes
 * any whole number up to 30; these are the ones worth offering. */
const LEAD_TIMES = [0, 1, 2, 3, 5, 7, 14, 30]

function leadLabel(days: number): string {
  if (days === 0) return 'Only on the day'
  return days === 1 ? '1 day before' : `${days} days before`
}

/**
 * Where to be reminded that a game in the library is about to come out.
 *
 * Only the channels the administrator has set up on this deployment are
 * listed. Each is switched on and configured on its own.
 */
export function NotificationsSection() {
  const channels = useNotificationChannels()

  if (channels.isPending) return null
  if (channels.isError) return <Notice tone="error">{errorMessage(channels.error)}</Notice>

  if (channels.data.length === 0) {
    return (
      <p className="text-[13px] text-ink-faint">
        No notification channel has been set up on this deployment. Ask your administrator to
        configure one.
      </p>
    )
  }

  return (
    <div className="flex max-w-[420px] flex-col gap-3">
      {channels.data.map((channel) => (
        <ChannelCard key={channel.type} channel={channel} />
      ))}
    </div>
  )
}

/** One channel: its switch, its settings and how early to be reminded. */
function ChannelCard({ channel }: { channel: NotificationChannel }) {
  const [enabled, setEnabled] = useState(channel.enabled)
  const [daysBefore, setDaysBefore] = useState(channel.days_before)
  const [settings, setSettings] = useState(channel.settings)

  const update = useUpdateNotificationChannel()
  const test = useTestNotificationChannel()

  const dirty =
    enabled !== channel.enabled ||
    daysBefore !== channel.days_before ||
    channel.fields.some((field) => (settings[field.key] ?? '') !== (channel.settings[field.key] ?? ''))
  const complete = channel.fields.every((field) => !field.required || (settings[field.key] ?? '') !== '')

  const leadTimes = LEAD_TIMES.includes(daysBefore)
    ? LEAD_TIMES
    : [...LEAD_TIMES, daysBefore].sort((a, b) => a - b)

  function save(event: FormEvent) {
    event.preventDefault()
    test.reset()
    update.mutate({ type: channel.type, input: { enabled, days_before: daysBefore, settings } })
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-control bg-sunken p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-ink">{channel.name}</h3>
          <p className="text-[13px] text-ink-muted">{channel.description}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ink-muted">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          On
        </label>
      </div>

      {channel.fields.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          placeholder={field.placeholder}
          hint={field.hint}
          required={enabled && field.required}
          value={settings[field.key] ?? ''}
          onChange={(event) => setSettings({ ...settings, [field.key]: event.target.value })}
          className="bg-canvas"
        />
      ))}

      <Select
        label="Remind me"
        value={String(daysBefore)}
        onChange={(value) => setDaysBefore(Number(value))}
        options={leadTimes.map((days) => ({ value: String(days), label: leadLabel(days) }))}
        hint="You are always told on the day a game comes out."
      />

      {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
      {update.isSuccess && !dirty && <Notice tone="ok">Saved.</Notice>}
      {test.isError && <Notice tone="error">{errorMessage(test.error)}</Notice>}
      {test.isSuccess && <Notice tone="ok">Test sent. It should arrive in a moment.</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => test.mutate(channel.type)}
          disabled={dirty || !complete || test.isPending}
        >
          {test.isPending ? 'Sending…' : 'Send a test'}
        </Button>
      </div>
    </form>
  )
}

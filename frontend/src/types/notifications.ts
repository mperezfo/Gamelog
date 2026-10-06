/** One setting a channel asks an account for. */
export interface NotificationField {
  key: string
  label: string
  placeholder?: string
  hint?: string
  required: boolean
}

/** A way of being reminded that this deployment offers, with what the
 * account has set up for it. */
export interface NotificationChannel {
  type: string
  name: string
  description: string
  fields: NotificationField[]
  enabled: boolean
  /** Days ahead of a release the reminder is sent. 0 means only on the day. */
  days_before: number
  settings: Record<string, string>
}

/** What an account saves for a channel. */
export interface NotificationChannelInput {
  enabled: boolean
  days_before: number
  settings: Record<string, string>
}

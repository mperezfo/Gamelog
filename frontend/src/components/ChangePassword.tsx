import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { useChangePassword } from '../hooks/useSession'
import { Button } from './Button'
import { Field } from './Field'
import { Notice } from './Notice'

/**
 * Changing your own password.
 *
 * The old password is asked for because this is a change and not a reset:
 * without it, an unattended browser would be enough to lock somebody out of
 * their own library. Whoever genuinely forgot theirs goes to the admin.
 */
export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [done, setDone] = useState(false)

  const change = useChangePassword()

  function submit(event: FormEvent) {
    event.preventDefault()
    setDone(false)

    if (next !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)

    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          setConfirmation('')
          setDone(true)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex max-w-[320px] flex-col gap-4">
      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        required
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
        value={next}
        onChange={(event) => setNext(event.target.value)}
        required
      />
      <Field
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
      />

      {mismatch && <Notice tone="error">The two new passwords are not the same.</Notice>}
      {change.isError && <Notice tone="error">{errorMessage(change.error)}</Notice>}
      {done && (
        <Notice tone="ok">
          Password changed. Any other browser signed in as you has been signed out.
        </Notice>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={change.isPending}>
          {change.isPending ? 'Changing…' : 'Change password'}
        </Button>
      </div>
    </form>
  )
}

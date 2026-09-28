import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { useRunSetup } from '../hooks/useSetup'

interface SetupProps {
  adminUsername: string
}

/**
 * First run: choosing the admin password.
 *
 * This screen exists only while the deployment has no accounts at all. The
 * name is not asked for — there is one management account and it is called
 * whatever the backend says — so there is a single thing to decide here.
 */
export function Setup({ adminUsername }: SetupProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const setup = useRunSetup()

  function submit(event: FormEvent) {
    event.preventDefault()

    if (password !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setup.mutate(password)
  }

  return (
    <AuthLayout
      title="Set up Gamelog"
      description={`Nobody has an account on this deployment yet. Choose a password for ${adminUsername}, the account that creates and removes the others. It has no library of its own.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Hidden, but there so that a password manager files the entry under
            the right account instead of guessing. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={adminUsername}
          readOnly
          hidden
        />

        <Field
          label="Admin password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters. There is no way to recover it from the browser."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />
        <Field
          label="Repeat the password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />

        {mismatch && <Notice tone="error">The two passwords are not the same.</Notice>}
        {setup.isError && <Notice tone="error">{errorMessage(setup.error)}</Notice>}

        <Button type="submit" variant="primary" block disabled={setup.isPending}>
          {setup.isPending ? 'Creating…' : 'Create the admin account'}
        </Button>
      </form>
    </AuthLayout>
  )
}

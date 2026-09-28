import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { useLogin } from '../hooks/useSession'

/**
 * The only door. There is no sign-up link because there is no self
 * registration: accounts exist because the admin created them.
 */
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const signIn = useLogin()

  function submit(event: FormEvent) {
    event.preventDefault()
    signIn.mutate({ username, password })
  }

  return (
    <AuthLayout
      title="Gamelog"
      description="Sign in to your library. Sessions last a long time, so this should be a rare screen."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Account"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {signIn.isError && <Notice tone="error">{errorMessage(signIn.error)}</Notice>}

        <Button type="submit" variant="primary" block disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-xs leading-relaxed text-ink-faint">
          Forgotten your password? The admin of this deployment can set a new one for you.
        </p>
      </form>
    </AuthLayout>
  )
}

import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { Button } from '../components/Button'
import { ChangePassword } from '../components/ChangePassword'
import { Field } from '../components/Field'
import { KeyIcon, TrashIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { PageContainer } from '../components/PageContainer'
import { Section } from '../components/Section'
import { useCreateUser, useDeleteUser, useResetUserPassword, useUsers } from '../hooks/useUsers'
import type { User } from '../types/auth'

/**
 * What the admin sees: the accounts, and nothing else.
 *
 * The admin owns no library, so there is no game anywhere on this screen. The
 * API enforces that rather than trusting this page to leave it out.
 */
export function Admin({ admin }: { admin: User }) {
  const users = useUsers()

  return (
    <PageContainer>
      <div className="flex flex-col gap-10">
        <Section
          title="Accounts"
          description="Everybody who can sign in to this deployment. Each one has a library of its own that nobody else can see."
        >
          {users.isPending && <p className="text-[13px] text-ink-faint">Loading…</p>}
          {users.isError && <Notice tone="error">{errorMessage(users.error)}</Notice>}

          {users.data && (
            <ul className="flex flex-col">
              {users.data.map((user) => (
                <UserRow key={user.id} user={user} isSelf={user.id === admin.id} />
              ))}
            </ul>
          )}

          <CreateUser />
        </Section>

        <Section
          title="Your password"
          description="The admin password. Changing it signs out every other browser you are signed in on."
        >
          <ChangePassword />
        </Section>
      </div>
    </PageContainer>
  )
}

/** One account, with the two things that can be done to it. */
function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const [panel, setPanel] = useState<'none' | 'reset' | 'delete'>('none')

  return (
    <li className="group border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-ink">
            <span className="truncate font-medium">{user.username}</span>
            {user.is_admin && (
              <span className="shrink-0 rounded-[3px] bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                Admin
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Added {new Date(user.created_at).toLocaleDateString()}
          </p>
        </div>

        {/*
          The actions stay out of the way until the row is pointed at, which is
          the desktop behaviour. On touch there is no hover, so they are always
          there.
        */}
        {/*
          Nothing on your own row. Resetting your own password here would end
          the session doing it and drop you back on the login screen mid-click;
          the section below does the same thing properly, and deleting yourself
          is refused by the API anyway.
        */}
        {!isSelf && (
          <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <Button
              variant="ghost"
              title="Set a new password"
              aria-label={`Set a new password for ${user.username}`}
              onClick={() => setPanel(panel === 'reset' ? 'none' : 'reset')}
              className="px-2"
            >
              <KeyIcon />
            </Button>
            <Button
              variant="danger"
              title="Delete this account"
              aria-label={`Delete ${user.username}`}
              onClick={() => setPanel(panel === 'delete' ? 'none' : 'delete')}
              className="px-2"
            >
              <TrashIcon />
            </Button>
          </div>
        )}
      </div>

      {panel === 'reset' && <ResetPassword user={user} onDone={() => setPanel('none')} />}
      {panel === 'delete' && <DeleteUser user={user} onCancel={() => setPanel('none')} />}
    </li>
  )
}

/** Setting somebody's password for them: the recovery path for a forgotten one. */
function ResetPassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useResetUserPassword()

  function submit(event: FormEvent) {
    event.preventDefault()
    reset.mutate({ id: user.id, password }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 pb-4 sm:max-w-[320px]">
      <Field
        label={`New password for ${user.username}`}
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters. Every session this account had ends."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
        required
      />
      {reset.isError && <Notice tone="error">{errorMessage(reset.error)}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={reset.isPending}>
          {reset.isPending ? 'Setting…' : 'Set password'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

/** Deleting an account, confirmed in place rather than in a dialog. */
function DeleteUser({ user, onCancel }: { user: User; onCancel: () => void }) {
  const remove = useDeleteUser()

  return (
    <div className="flex flex-col gap-3 pb-4 sm:max-w-[420px]">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Deleting <span className="font-medium text-ink">{user.username}</span> removes everything
        that was only ever theirs — games, genres, developers, publishers and platforms — and
        cannot be undone.
      </p>
      {remove.isError && <Notice tone="error">{errorMessage(remove.error)}</Notice>}
      <div className="flex gap-2">
        <Button
          variant="danger"
          className="border border-danger/30"
          disabled={remove.isPending}
          onClick={() => remove.mutate(user.id, { onSuccess: onCancel })}
        >
          {remove.isPending ? 'Deleting…' : `Delete ${user.username}`}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

/** Adding an account. The person it belongs to changes the password later. */
function CreateUser() {
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const create = useCreateUser()

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      { username, password },
      {
        onSuccess: () => {
          setUsername('')
          setPassword('')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Add an account</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 sm:max-w-[320px]">
      <Field
        label="Account name"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        hint="Compared ignoring case and accents, so it has to be distinct from the others."
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoFocus
        required
      />
      <Field
        label="Initial password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters. Its owner can change it once they are in."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {create.isError && <Notice tone="error">{errorMessage(create.error)}</Notice>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create account'}
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  )
}

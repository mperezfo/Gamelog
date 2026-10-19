import { useState, type FormEvent } from 'react'

import { errorMessage } from '../api/client'
import { useUpdateProfile } from '../hooks/useSession'
import { MAX_NAME, type User } from '../types/auth'
import { AvatarField } from './AvatarField'
import { Button } from './Button'
import { Field } from './Field'
import { Notice } from './Notice'

/** Name and profile picture — what the application shows, as opposed to the
 * username the login screen asks for. */
export function ProfileForm({ user }: { user: User }) {
  const [name, setName] = useState(user.name)
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '')
  const update = useUpdateProfile()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    update.mutate({ name, avatarUrl: avatarUrl || null })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 sm:max-w-[320px]">
      <AvatarField value={avatarUrl} onChange={setAvatarUrl} />
      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={MAX_NAME}
      />

      {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
      {update.isSuccess && <Notice tone="ok">Saved.</Notice>}

      <div>
        <Button type="submit" variant="primary" disabled={update.isPending || !name.trim()}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

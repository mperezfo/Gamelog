import { AuthLayout } from '../components/AuthLayout'
import { ChangePassword } from '../components/ChangePassword'

/**
 * Shown instead of the application right after a backup is restored: the
 * account's password was just overwritten with whatever the backup carried,
 * so nothing else is reachable until a fresh one replaces it.
 */
export function ForcedPasswordChange() {
  return (
    <AuthLayout
      title="Change your password"
      description="A backup was just restored onto this account, which replaced your password with the one it carried. Choose a new one to continue."
    >
      <ChangePassword />
    </AuthLayout>
  )
}

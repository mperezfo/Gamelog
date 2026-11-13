import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createUser, deleteUser, listUsers, resetUserPassword, unlockUser } from '../api/users'

const usersKey = ['users'] as const

/** How often the list is read again while an account in it is locked, so
 * that a lock that runs out stops showing soon after. */
const LOCKED_REFETCH_MS = 30_000

/** Every account. Admin only, like the endpoint behind it. */
export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: listUsers,
    refetchInterval: (query) => (query.state.data?.some((user) => user.locked_until) ? LOCKED_REFETCH_MS : false),
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      createUser(username, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  })
}

export function useResetUserPassword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      resetUserPassword(id, password),
    // A new password lifts the account's lock too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  })
}

export function useUnlockUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: unlockUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  })
}

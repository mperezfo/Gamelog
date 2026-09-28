import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createUser, deleteUser, listUsers, resetUserPassword } from '../api/users'

const usersKey = ['users'] as const

/** Every account. Admin only, like the endpoint behind it. */
export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: listUsers })
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
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      resetUserPassword(id, password),
  })
}

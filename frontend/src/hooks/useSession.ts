import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { changePassword, getCurrentUser, login, logout, updatePreferences, updateProfile } from '../api/auth'
import type { DateFormat, GamesView, Theme, User } from '../types/auth'

/** Query key of the current session, so that logging in and out can reset it. */
export const sessionKey = ['session'] as const

/**
 * The account the browser is signed in as, or null.
 *
 * It is the first thing the application asks and what it decides between the
 * login screen and the application itself on. The cookie is long-lived and
 * only ends deliberately, so there is nothing to poll for.
 */
export function useSession() {
  return useQuery<User | null>({
    queryKey: sessionKey,
    queryFn: getCurrentUser,
    staleTime: Infinity,
    retry: 1,
  })
}

/** Signs in and puts the account straight into the cache. */
export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKey, user)
      // The admin's screens are behind their own queries; nothing that was
      // read as the previous account should survive into this one.
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/** Signs out, clearing everything that was read while signed in. */
export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Setting the session first is what switches the app to the login
      // screen: Gate re-renders and unmounts every session-gated query's
      // observer (the board, the games table, the sidebar search…) off the
      // back of this state change.
      //
      // Clearing the rest of the cache is deferred to a fresh macrotask
      // rather than done right here, so it runs only after that unmount has
      // actually committed — doing it in the same tick raced React's commit:
      // a still-mounted observer would see its query removed, refetch it
      // straight away, get a 401, and throw before ever getting the chance
      // to unmount, which is what made logging out look like it needed a
      // reload to take effect.
      queryClient.setQueryData(sessionKey, null)
      setTimeout(() => {
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
      }, 0)
    },
  })
}

/** The signed-in account's date format, or the default while it is still
 * loading or nobody is signed in. */
export function useDateFormat(): DateFormat {
  const session = useSession()
  return session.data?.date_format ?? 'long'
}

/** The signed-in account's default Games view, or 'table' while it is still
 * loading or nobody is signed in. */
export function useDefaultGamesView(): GamesView {
  const session = useSession()
  return session.data?.games_view ?? 'table'
}

/** Changes the theme, date format and/or default games view the application
 * is shown in. All three travel with the account, so this is what keeps
 * them in sync across devices and lets them ride along with the rest of a
 * backup. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ theme, dateFormat, gamesView }: { theme: Theme; dateFormat: DateFormat; gamesView: GamesView }) =>
      updatePreferences(theme, dateFormat, gamesView),
    onSuccess: (user) => queryClient.setQueryData(sessionKey, user),
  })
}

/** Changes your name and/or profile picture, shown throughout the application. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, avatarUrl }: { name: string; avatarUrl: string | null }) =>
      updateProfile(name, avatarUrl),
    onSuccess: (user) => queryClient.setQueryData(sessionKey, user),
  })
}

/** Replaces your own password, which ends every other session. */
export function useChangePassword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      changePassword(current, next),
    // The answer carries a fresh session, so this browser stays signed in.
    onSuccess: (user) => queryClient.setQueryData(sessionKey, user),
  })
}

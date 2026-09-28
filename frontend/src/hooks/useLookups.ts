import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createLookup, deleteLookup, listLookups, updateLookup } from '../api/lookups'
import type { LookupInput, LookupKind } from '../types/lookup'

const lookupKey = (kind: LookupKind) => [kind] as const

/** Every genre, developer, publisher or platform in the signed-in account's own library. */
export function useLookups(kind: LookupKind) {
  return useQuery({ queryKey: lookupKey(kind), queryFn: () => listLookups(kind) })
}

export function useCreateLookup(kind: LookupKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LookupInput) => createLookup(kind, input),
    // Games elsewhere reference these by id and cache their names inline, so a
    // rename or a new entry has to invalidate the library too.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lookupKey(kind) })
      void queryClient.invalidateQueries({ queryKey: ['games'] })
    },
  })
}

export function useUpdateLookup(kind: LookupKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: LookupInput }) => updateLookup(kind, id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lookupKey(kind) })
      void queryClient.invalidateQueries({ queryKey: ['games'] })
    },
  })
}

export function useDeleteLookup(kind: LookupKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteLookup(kind, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lookupKey(kind) })
      void queryClient.invalidateQueries({ queryKey: ['games'] })
    },
  })
}

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { exportBackup, importBackup } from '../api/backup'
import { sessionKey } from './useSession'

/** Downloads a full account backup and saves it as a file. */
export function useExportBackup() {
  return useMutation({
    mutationFn: async () => {
      const blob = await exportBackup()
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = `gamelog-backup-${new Date().toISOString().slice(0, 10)}.zip`
        link.click()
      } finally {
        URL.revokeObjectURL(url)
      }
    },
  })
}

/** Restores a full account backup.
 *
 * Everything the previous account read — games, catalogues, the session
 * itself — is stale after this, so the whole cache is dropped rather than
 * patched. Re-reading the session is what makes the application notice the
 * account now needs a fresh password.
 */
export function useImportBackup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: importBackup,
    onSuccess: () => {
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
}

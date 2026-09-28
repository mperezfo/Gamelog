import { useRef, useState, type ChangeEvent } from 'react'

import { errorMessage } from '../api/client'
import { useExportBackup, useImportBackup } from '../hooks/useBackup'
import { Button } from './Button'
import { Notice } from './Notice'

/**
 * Exporting and restoring the whole account as one .zip: games, catalogues,
 * profile and password, plus every cover and avatar image they use.
 *
 * Restoring is a replace, not a merge — it is meant for moving to a new
 * deployment or recovering from one lost, not for combining two libraries —
 * so a file picked here is held back for a confirmation before anything is
 * written.
 */
export function BackupSection() {
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [imported, setImported] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const exportBackup = useExportBackup()
  const importBackup = useImportBackup()

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    setImported(false)
    setPendingFile(file)
  }

  function confirmImport() {
    if (!pendingFile) return
    importBackup.mutate(pendingFile, {
      onSuccess: () => {
        setPendingFile(null)
        setImported(true)
      },
    })
  }

  return (
    <div className="flex max-w-[420px] flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button className="w-44" onClick={() => exportBackup.mutate()} disabled={exportBackup.isPending}>
          {exportBackup.isPending ? 'Preparing…' : 'Export a backup'}
        </Button>
        <Button className="w-44" variant="secondary" onClick={() => fileInput.current?.click()}>
          Import a backup…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onFileChosen}
        />
      </div>

      {exportBackup.isError && <Notice tone="error">{errorMessage(exportBackup.error)}</Notice>}

      {pendingFile && (
        <div className="rounded-control bg-danger-soft px-3 py-3 text-[13px]">
          <p className="font-medium text-ink">Replace everything with {pendingFile.name}?</p>
          <p className="mt-1 text-ink-muted">
            Your games, genres, developers, publishers, platforms, profile and password are all
            overwritten with what the backup holds. You will have to change your password
            afterwards, and every other browser you are signed in on will be signed out.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" onClick={confirmImport} disabled={importBackup.isPending}>
              {importBackup.isPending ? 'Restoring…' : 'Replace everything'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPendingFile(null)}
              disabled={importBackup.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {importBackup.isError && <Notice tone="error">{errorMessage(importBackup.error)}</Notice>}

      {imported && (
        <Notice tone="ok">Backup restored. Change your password to keep using Gamelog.</Notice>
      )}
    </div>
  )
}

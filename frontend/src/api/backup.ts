import type { ImportReport } from '../types/backup'
import { apiBlob, apiFetch } from './client'

/** Downloads a full account backup — library, catalogues, profile, password
 * and every image they use — as a .zip. */
export function exportBackup(): Promise<Blob> {
  return apiBlob('/backup')
}

/** Restores a full account backup. Replaces the library and the profile,
 * ends every session the account had including this one, and requires
 * changing the password before anything else works. */
export function importBackup(file: File): Promise<ImportReport> {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type here: the browser sets the multipart boundary itself
  // when the body is a FormData.
  return apiFetch<ImportReport>('/backup', { method: 'POST', body: form })
}

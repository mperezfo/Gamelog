import { apiFetch, apiSend, TRANSFER_TIMEOUT_MS } from './client'

/** Uploads a cover image and returns the path it is served from. */
export function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type here: the browser sets the multipart boundary itself when
  // the body is a FormData, and overriding it would drop that boundary.
  return apiFetch<{ url: string }>('/images', { method: 'POST', body: form }, TRANSFER_TIMEOUT_MS)
}

/** Copies an image found with the image search into the library, and
 * returns the path it is served from, as an upload would. The server
 * downloads it first, and reduces it when it is too large to keep as it is. */
export function importImage(url: string): Promise<{ url: string }> {
  return apiSend<{ url: string }>('/images/import', 'POST', { url }, TRANSFER_TIMEOUT_MS)
}

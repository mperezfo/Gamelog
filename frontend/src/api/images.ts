import { apiFetch, apiSend } from './client'

/** Uploads a cover image and returns the path it is served from. */
export function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type here: the browser sets the multipart boundary itself when
  // the body is a FormData, and overriding it would drop that boundary.
  return apiFetch<{ url: string }>('/images', { method: 'POST', body: form })
}

/** Copies an image found with the image search into the library, and
 * returns the path it is served from, as an upload would. */
export function importImage(url: string): Promise<{ url: string }> {
  return apiSend<{ url: string }>('/images/import', 'POST', { url })
}

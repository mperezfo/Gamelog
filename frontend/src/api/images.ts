import { apiFetch } from './client'

/** Uploads a cover image and returns the path it is served from. */
export function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type here: the browser sets the multipart boundary itself when
  // the body is a FormData, and overriding it would drop that boundary.
  return apiFetch<{ url: string }>('/images', { method: 'POST', body: form })
}

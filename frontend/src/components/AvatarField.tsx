import { useRef, useState } from 'react'

import { errorMessage } from '../api/client'
import { uploadImage } from '../api/images'
import { Avatar } from './Avatar'
import { CameraIcon } from './icons'
import { Notice } from './Notice'

interface AvatarFieldProps {
  value: string
  onChange: (url: string) => void
}

/** A circular profile picture upload — CoverImageField's shape, for a face
 * instead of a box art. */
export function AvatarField({ value, onChange }: AvatarFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      onChange(url)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group relative size-16 shrink-0 overflow-hidden rounded-full"
          aria-label={value ? 'Replace profile picture' : 'Add a profile picture'}
        >
          <Avatar avatarUrl={value} className="size-16" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-75 group-hover:opacity-100">
            <CameraIcon className="size-5 text-white" />
          </span>
        </button>

        <div className="flex flex-col gap-1 text-xs">
          <button type="button" onClick={() => inputRef.current?.click()} className="text-left font-medium text-accent hover:underline">
            {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload a photo'}
          </button>
          {value && !uploading && (
            <button type="button" onClick={() => onChange('')} className="text-left text-ink-faint hover:text-ink">
              Remove
            </button>
          )}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

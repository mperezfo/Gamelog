import type { ReactNode } from 'react'

/** The padded, centred column narrow pages (account, admin) sit in. */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">{children}</div>
}

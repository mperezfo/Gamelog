import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { cjkStyle } from './lib/cjk'
import { registerServiceWorker } from './lib/serviceWorker'
// The interface font, Latin and Latin Extended, and the one for Cyrillic,
// Greek and Vietnamese (see --font-sans in index.css).
import '@fontsource-variable/figtree'
import '@fontsource-variable/noto-sans/wght.css'
import './index.css'

// The Chinese, Japanese and Korean fonts. Their stylesheets alone, a few
// hundred `unicode-range` lists, come to well over 100 kB compressed, so
// they load once the app has started rather than holding up its first
// paint; until then, as until any font arrives, the system's stands in.
void import('@fontsource-variable/noto-sans-jp/wght.css')
void import('@fontsource-variable/noto-sans-kr/wght.css')
void import('@fontsource-variable/noto-sans-sc/wght.css')
void import('@fontsource-variable/noto-sans-tc/wght.css')

const cjk = cjkStyle(navigator.languages)
if (cjk) document.documentElement.dataset.cjk = cjk

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

registerServiceWorker()

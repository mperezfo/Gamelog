import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { registerServiceWorker } from './lib/serviceWorker'
// The interface font, Latin and Latin Extended (see --font-sans in index.css).
import '@fontsource-variable/figtree'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

registerServiceWorker()

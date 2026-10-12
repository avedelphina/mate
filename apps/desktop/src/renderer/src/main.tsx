import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// The Mac draws the window buttons over the page. The stylesheet leaves room for them there only.
if (navigator.userAgent.includes('Macintosh')) document.documentElement.dataset.platform = 'mac'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

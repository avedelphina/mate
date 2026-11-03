import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Boundary } from './Boundary'
import { showTooltips } from './tooltip'

// The Mac draws the window buttons over the page. The stylesheet leaves room for them there only.
if (navigator.userAgent.includes('Macintosh')) document.documentElement.dataset.platform = 'mac'

showTooltips()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary what="The window">
      <App />
    </Boundary>
  </StrictMode>
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PortalApp from './PortalApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
)

import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Two apps from one codebase: `vite --mode user` builds the public User app (no accounts), the default builds the
// staff Admin app. VITE_APP is inlined at build time, so each bundle only contains its own app.
const App = import.meta.env.VITE_APP === 'user' ? lazy(() => import('./UserApp.tsx')) : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
)

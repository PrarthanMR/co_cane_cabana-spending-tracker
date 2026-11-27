import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { FrontendErrorBoundary } from './components/FrontendErrorBoundary'
import { installGlobalErrorReporting } from './services/diagnostics'

installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrontendErrorBoundary>
      <App />
    </FrontendErrorBoundary>
  </StrictMode>,
)

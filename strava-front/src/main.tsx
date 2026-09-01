import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.scss'
import App from './App.tsx'
import { applyTheme, resolveInitialTheme } from './utils/theme.ts'

applyTheme(resolveInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

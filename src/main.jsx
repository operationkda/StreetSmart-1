import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppStateProvider } from '@/state/AppState.jsx'
import { AppRoutes } from '@/pages/AppRoutes.jsx'
import { ErrorBoundary } from '@/components/ErrorBoundary.jsx'
import { OfflineIndicator } from '@/components/OfflineIndicator.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppStateProvider>
          <OfflineIndicator />
          <AppRoutes />
        </AppStateProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

import { createContext, useContext, useMemo, useState } from 'react'

const AppStateContext = createContext(undefined)

function readStoredToken() {
  try {
    return localStorage.getItem('authToken') ?? ''
  } catch {
    return ''
  }
}

export function AppStateProvider({ children }) {
  const [authToken, setAuthToken] = useState(readStoredToken)

  const value = useMemo(
    () => ({
      authToken,
      setAuthToken: (token) => {
        setAuthToken(token)

        try {
          if (token) {
            localStorage.setItem('authToken', token)
          } else {
            localStorage.removeItem('authToken')
          }
        } catch {
          // Ignore storage errors and keep state in memory.
        }
      },
    }),
    [authToken],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider')
  }

  return context
}

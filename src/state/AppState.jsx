import { createContext, useContext, useMemo, useState } from 'react'

const AppStateContext = createContext(undefined)

function readStoredToken() {
  try {
    return localStorage.getItem('authToken') ?? ''
  } catch {
    return ''
  }
}

/**
 * Provides application-level auth token state and persistence.
 * @param {{children: import('react').ReactNode}} props
 * @returns {JSX.Element}
 */
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

/**
 * Reads app state context and throws when missing provider.
 * @returns {{authToken: string, setAuthToken: (token: string) => void}}
 */
export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider')
  }

  return context
}

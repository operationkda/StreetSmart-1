import { createContext, useContext, useMemo, useState } from 'react'

const AppStateContext = createContext(undefined)

export function AppStateProvider({ children }) {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') ?? '')

  const value = useMemo(
    () => ({
      authToken,
      setAuthToken: (token) => {
        setAuthToken(token)
        if (token) {
          localStorage.setItem('authToken', token)
        } else {
          localStorage.removeItem('authToken')
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

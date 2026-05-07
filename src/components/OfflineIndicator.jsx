import { useEffect, useState } from 'react'

/**
 * Displays a fixed banner when the device loses internet connectivity.
 * Disappears automatically once the connection is restored.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setOffline(false)
    }
    function handleOffline() {
      setOffline(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!offline) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#7f1d1d',
        color: '#fca5a5',
        textAlign: 'center',
        padding: '10px 16px',
        fontSize: 14,
        letterSpacing: '0.04em',
        // Respect the iOS safe-area inset so the banner sits below the notch
        paddingTop: 'max(10px, env(safe-area-inset-top))',
      }}
    >
      ⚠️ No network connection — dashboard data may be stale
    </div>
  )
}

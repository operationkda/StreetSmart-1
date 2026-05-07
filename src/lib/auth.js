export function decodeTokenClaims(token) {
  if (!token) return null

  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function decodeTokenRole(token) {
  return decodeTokenClaims(token)?.role ?? null
}

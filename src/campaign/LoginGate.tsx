// The first thing anyone sees: the sign-in page. Nothing else renders - no
// campaigns, no settings, no tools - until there is a session, and it comes
// straight back the moment the session ends (he signs out, or the server stops
// accepting the token).
//
// A signed-in phone keeps working with no signal: the session is a token kept
// on the device, so being offline never sends him back here. Only the first
// sign-in on a device needs a connection.
//
// This is the front door, not the lock. The lock is the server: every call
// that matters is refused without a valid token, so a person who skips this
// screen gets an empty app that cannot read or save anything.

import { useEffect, useState, type ReactNode } from 'react'

import { SESSION_EVENT, currentSession } from './cloud'
import { SignIn } from './SignIn'

export function LoginGate({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(() => currentSession() !== null)

  useEffect(() => {
    const check = () => setSignedIn(currentSession() !== null)
    window.addEventListener(SESSION_EVENT, check)
    // Another tab signing out signs this one out too.
    window.addEventListener('storage', check)
    return () => {
      window.removeEventListener(SESSION_EVENT, check)
      window.removeEventListener('storage', check)
    }
  }, [])

  if (!signedIn) {
    return (
      <main className="login-gate">
        <SignIn onSignedIn={() => setSignedIn(true)} />
      </main>
    )
  }
  return <>{children}</>
}

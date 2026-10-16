import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { currentSession } from './campaign/cloud'
import { CrashGuard } from './CrashGuard'
import { applyTheme, followPhone } from './theme'
import { ModeNav, plainCutterWorkToLose } from './ModeNav'
import { CUT_ONLY_HASH, staysOnCutOnly } from './opening'
import './index.css'
import './modes.css'

// Light or dark before anything is drawn, so nothing flashes the other one.
applyTheme()
followPhone()

void staysOnCutOnly().then((stay) => {
  // Signed out, this page does not open at all: the sign-in page is
  // campaign.html's, and there is only one front door.
  if (!stay || currentSession() === null) {
    window.location.replace('/campaign.html')
    return
  }
  // Kept on Cut only by a waiting video: a reload keeps it here too.
  if (window.location.hash !== CUT_ONLY_HASH) history.replaceState(null, '', `/${CUT_ONLY_HASH}`)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CrashGuard>
        <ModeNav current="cut" workToLose={plainCutterWorkToLose} />
        <App />
      </CrashGuard>
    </StrictMode>,
  )
})

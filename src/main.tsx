import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { CrashGuard } from './CrashGuard'
import { ModeNav, plainCutterWorkToLose } from './ModeNav'
import { CUT_ONLY_HASH, staysOnCutOnly } from './opening'
import './index.css'
import './modes.css'

void staysOnCutOnly().then((stay) => {
  if (!stay) {
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

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { CrashGuard } from '../CrashGuard'
import { applyTheme, followPhone } from '../theme'
import '../index.css'
import '../modes.css'
import './campaign.css'
import { CampaignApp } from './CampaignApp'
import { LoginGate } from './LoginGate'
import { SERVER_MODE } from './serverFlag'
import { startServerMode } from './serverMode'
import { watchZoom } from './zoomWatch'

// Light or dark before anything is drawn, so nothing flashes the other one.
applyTheme()
followPhone()
watchZoom()

const show = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CrashGuard>
        <LoginGate>
          <CampaignApp />
        </LoginGate>
      </CrashGuard>
    </StrictMode>,
  )

// On the Cutter server, signed in and set up first (serverMode.ts); on a
// phone, nothing to wait for.
if (SERVER_MODE) {
  startServerMode()
    .then(show)
    .catch((error) => {
      document.body.textContent = error instanceof Error ? error.message : String(error)
      // Connected meanwhile: the server opens it again, or this tries again.
      setTimeout(() => location.reload(), 60_000)
    })
} else show()

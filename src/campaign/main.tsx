import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { CrashGuard } from '../CrashGuard'
import { applyTheme, followPhone } from '../theme'
import '../index.css'
import '../modes.css'
import './campaign.css'
import { CampaignApp } from './CampaignApp'
import { LoginGate } from './LoginGate'
import { watchZoom } from './zoomWatch'

// Light or dark before anything is drawn, so nothing flashes the other one.
applyTheme()
followPhone()
watchZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
      <LoginGate>
        <CampaignApp />
      </LoginGate>
    </CrashGuard>
  </StrictMode>,
)

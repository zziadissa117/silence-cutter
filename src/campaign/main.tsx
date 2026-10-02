import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { CrashGuard } from '../CrashGuard'
import '../index.css'
import '../modes.css'
import './campaign.css'
import { CampaignApp } from './CampaignApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
      <CampaignApp />
    </CrashGuard>
  </StrictMode>,
)

import { applyTheme, followPhone } from './theme'
import { CUT_ONLY_HASH, staysOnCutOnly } from './opening'
import './index.css'
import './modes.css'

// Light or dark before anything is drawn, so nothing flashes the other one.
applyTheme()
followPhone()

// Decided before anything else is loaded: "/" usually moves straight on to
// Campaign videos (see opening.ts), so the cutter's code - React, the media
// library, the queue - is only fetched and run when the page is staying.
// Written without JSX on purpose: JSX would pull React in up front.
void staysOnCutOnly().then(async (stay) => {
  if (!stay) {
    window.location.replace('/campaign.html')
    return
  }
  // Signed out, this page does not open at all: the sign-in page is
  // campaign.html's, and there is only one front door.
  const { currentSession } = await import('./campaign/cloud')
  if (currentSession() === null) {
    window.location.replace('/campaign.html')
    return
  }
  // Kept on Cut only by a waiting video: a reload keeps it here too.
  if (window.location.hash !== CUT_ONLY_HASH) history.replaceState(null, '', `/${CUT_ONLY_HASH}`)
  const [{ StrictMode, createElement }, { createRoot }, { App }, { CrashGuard }, { ModeNav, plainCutterWorkToLose }] =
    await Promise.all([import('react'), import('react-dom/client'), import('./App'), import('./CrashGuard'), import('./ModeNav')])
  createRoot(document.getElementById('root')!).render(
    createElement(
      StrictMode,
      null,
      createElement(
        CrashGuard,
        null,
        createElement(ModeNav, { current: 'cut', workToLose: plainCutterWorkToLose }),
        createElement(App),
      ),
    ),
  )
})

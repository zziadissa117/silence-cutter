// Notifications from the posting: "6 posts to approve", "Submit your
// Pump.fun video now". Sent by the postiz function as web push, shown by the
// service worker (public/push-sw.js), and opening the Posts screen when
// tapped.
//
// iOS allows them only for the app added to the Home Screen, and only when
// turned on from a tap.

import { within } from '../media/within'
import { isAppleTouch } from '../pickFormat'
import { dropPushSubscription, savePushSubscription } from './posting'

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'home-screen'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4)
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function standalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isAppleTouch() && !standalone() ? 'home-screen' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    return subscription && Notification.permission === 'granted' ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/** Asks, from his tap, and tells the server where to send. */
export async function turnOnPush(vapidPublic: string): Promise<PushState> {
  if (!supported()) return isAppleTouch() && !standalone() ? 'home-screen' : 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  // Never waits for ever: "ready" only resolves once a service worker is
  // in charge, and a page whose registration failed has none.
  const registration = await within(navigator.serviceWorker.ready, 5000, null)
  if (!registration) throw new Error("the app's background part isn't running - update or reinstall it from the Home Screen")
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublic) }))
  await savePushSubscription(subscription.toJSON())
  return 'on'
}

/** Stops the notifications: the server forgets this phone, then the phone
 *  lets its address go. For when posting is disconnected here - the server
 *  kept sending "posts to approve" for a profile this phone no longer
 *  posts. */
export async function turnOffPush(): Promise<void> {
  if (!supported()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await dropPushSubscription(subscription.endpoint).catch(() => {})
    await subscription.unsubscribe()
  } catch {
    // Then the push service's own 410 ends it, later.
  }
}

/** Tells the server again where this phone is, in case it forgot - the
 *  push service can change the address. Quietly; nothing is asked. */
export async function refreshPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) await savePushSubscription(subscription.toJSON())
  } catch {
    // Next time.
  }
}

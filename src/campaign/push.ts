// Notifications from the posting: "6 posts to approve", "Submit your
// Pump.fun video now". Sent by the postiz function as web push, shown by the
// service worker (public/push-sw.js), and opening the Posts screen when
// tapped.
//
// iOS allows them only for the app added to the Home Screen, and only when
// turned on from a tap.

import { isAppleTouch } from '../pickFormat'
import { savePushSubscription } from './posting'

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
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublic) }))
  await savePushSubscription(subscription.toJSON())
  return 'on'
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

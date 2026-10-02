// Notifications from the posting (supabase/functions/postiz), shown by the
// app's service worker - which workbox builds; this file is pulled into it
// (see vite.config.ts). A tap opens the Posts screen, in the app already
// open if there is one, or the link the notification carries.

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Campaign videos', {
      body: message.body || '',
      tag: message.tag || undefined,
      icon: '/icon.svg',
      data: { url: message.url || '/campaign.html#posts' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/campaign.html#posts', self.location.origin)
  event.waitUntil(
    (async () => {
      if (url.origin === self.location.origin) {
        const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const page = open.find((client) => new URL(client.url).pathname === '/campaign.html')
        if (page) {
          // Told first, so the Posts screen opens even if bringing the app
          // forward is refused.
          page.postMessage({ type: 'open', hash: url.hash })
          await page.focus().catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url.href)
    })(),
  )
})

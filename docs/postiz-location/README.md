# Asking Postiz for Instagram locations

What to send Postiz - their support chat, or an issue / pull request on
GitHub (`gitroomhq/postiz-app`). The change itself is in
`instagram-location.patch` beside this file (about 30 lines, against Postiz's
`main` of 2026-10-22; it applies cleanly there).

---

**Title:** Instagram: let the public API tag a post with a location (`location_id`)

Hi! We schedule Instagram Reels through the Postiz public API (`POST /public/v1/posts`)
and need every post tagged with a location. Instagram's Content Publishing API
already supports this: the media container endpoint (`POST /{ig-user-id}/media`)
takes `location_id`, the Facebook Page ID of a place, for images, videos/Reels
and carousels. Postiz's Instagram settings don't have it yet, so it can't be
sent.

Could you add an optional `location_id` to the Instagram settings and pass it on?

```json
"settings": {
  "__type": "instagram",
  "post_type": "post",
  "location_id": "110970792260960"
}
```

The change (patch attached, two files):

1. `libraries/nestjs-libraries/src/dtos/posts/providers-settings/instagram.dto.ts` -
   an optional string `location_id` on `InstagramDto`.
2. `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`,
   `postPending` - adds `&location_id=…` when creating the media container of a
   single image or Reel; for a carousel it goes on the CAROUSEL container in
   `finalizePost` (carried in `pendingData.locationId`), not on the items;
   never on stories. `instagram-standalone` uses the same `postPending`, so it
   gets it too.

Worth a test on an Instagram-Login account (`graph.instagram.com`) as well as a
Facebook-Login one - Meta documents `location_id` on the IG User Media
endpoint, but we couldn't test either from here.

A field for it in the post editor would be nice too, but the API is what we
need.

Thank you!

---

## On the Cutter's side

Already done: Settings, Posting has **Instagram location** (one place for every
Instagram post), and each campaign's Posting can have its own. Every Instagram
post the Cutter schedules carries it as `location_id` in its Postiz settings
(`supabase/functions/postiz/place.ts`, `settingsFor`). Postiz keeps settings
it doesn't know rather than refusing the post, so nothing breaks meanwhile -
and posts already scheduled carry it, so it shows the day Postiz ships this.

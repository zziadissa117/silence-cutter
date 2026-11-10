/** A failure worth showing as it is: its message is written for the person
 *  cutting the video, not for a developer. */
export class SilenceCutError extends Error {}

/** A video whose format this browser can't read - said the same way by the
 *  plain cutter and the campaign page. */
export const UNREADABLE_FORMAT =
  "This browser can't read this video's format. On a computer, open this page in Safari or Chrome; on a phone, update to the newest iOS."

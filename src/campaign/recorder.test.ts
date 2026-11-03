import { describe, expect, it } from 'vitest'

import { cameraConstraints, takeName } from './Recorder'

describe('the recorder', () => {
  it('names a take by when it was filmed, the next ones numbered', () => {
    const at = new Date(2026, 10, 3, 14, 5, 9)
    expect(takeName(at, 'video/mp4')).toBe('REC 2026-11-03 14-05-09.mp4')
    expect(takeName(at, 'video/webm;codecs=vp9', 1)).toBe('REC 2026-11-03 14-05-09 (2).webm')
  })

  it('asks the camera for 4K at 30 fps, and the mic as it hears', () => {
    const c = cameraConstraints('user') as { video: MediaTrackConstraints; audio: MediaTrackConstraints }
    expect(c.video.facingMode).toEqual({ ideal: 'user' })
    expect(c.video.width).toEqual({ ideal: 3840 })
    expect(c.video.frameRate).toEqual({ ideal: 30 })
    expect(c.audio.noiseSuppression).toBe(false)
  })
})

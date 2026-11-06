import { describe, expect, it } from 'vitest'

import { RECORD_HEIGHT, RECORD_WIDTH, cameraConstraints, coverBox, recordsDirect, takeName } from './Recorder'

describe('the recorder', () => {
  it('names a take by when it was filmed, the next ones numbered', () => {
    const at = new Date(2026, 10, 3, 14, 5, 9)
    expect(takeName(at, 'video/mp4')).toBe('REC 2026-11-03 14-05-09.mp4')
    expect(takeName(at, 'video/webm;codecs=vp9', 1)).toBe('REC 2026-11-03 14-05-09 (2).webm')
  })

  it('asks the camera for Full HD - the recording size - at 60 fps, and the mic as it hears', () => {
    const c = cameraConstraints('user') as { video: MediaTrackConstraints; audio: MediaTrackConstraints }
    expect(c.video.facingMode).toEqual({ ideal: 'user' })
    expect(c.video.width).toEqual({ ideal: 1920 })
    expect(c.video.height).toEqual({ ideal: 1080 })
    expect(c.video.frameRate).toEqual({ ideal: 60 })
    expect(c.audio.noiseSuppression).toBe(false)
  })
})

describe('what is recorded', () => {
  it('is 1080x1920, a camera frame filling it, cropped to fit', () => {
    expect([RECORD_WIDTH, RECORD_HEIGHT]).toEqual([1080, 1920])
    // A 4K portrait frame: the same shape, scaled down.
    expect(coverBox(2160, 3840)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
    // A landscape frame: filled to the height, the sides cropped.
    const wide = coverBox(1920, 1080)
    expect(wide.h).toBe(1920)
    expect(wide.x).toBeLessThan(0)
  })
})

describe('recording straight from the camera', () => {
  it('takes the back camera as it is - never the mirrored front one, a landscape picture or a picture zoom', () => {
    expect(recordsDirect({ mirrored: false, width: 1080, height: 1920, digitalZoom: 1 })).toBe(true)
    expect(recordsDirect({ mirrored: true, width: 1080, height: 1920, digitalZoom: 1 })).toBe(false)
    expect(recordsDirect({ mirrored: false, width: 1920, height: 1080, digitalZoom: 1 })).toBe(false)
    expect(recordsDirect({ mirrored: false, width: 1080, height: 1920, digitalZoom: 2 })).toBe(false)
    expect(recordsDirect({ mirrored: false, width: 0, height: 0, digitalZoom: 1 })).toBe(false)
  })
})

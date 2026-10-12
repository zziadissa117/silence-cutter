// A small picture of the "Claude + X" hook as it will sit on the videos -
// drawn with the same layout the render uses (formulaOverlay.ts), on a dark
// frame the shape of the video.

import { useEffect, useRef } from 'react'

import type { BankFile } from './batch'
import { drawFormula, layoutFormula } from './formulaOverlay'
import { headlineFontReady } from './headlineFont'
import type { Headline } from './look'

const WIDTH = 540
const HEIGHT = 960

export function FormulaPreview({
  left,
  right,
  line,
  look,
  load,
}: {
  left: BankFile | null
  right: BankFile | null
  line: string
  look: Headline
  load: (file: BankFile) => Promise<Blob | null>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const opened: ImageBitmap[] = []
    const image = async (file: BankFile | null) => {
      if (!file) return null
      const blob = await load(file).catch(() => null)
      if (!blob) return null
      const bitmap = await createImageBitmap(blob).catch(() => null)
      if (bitmap) opened.push(bitmap)
      return bitmap
    }
    void (async () => {
      const [l, r] = await Promise.all([image(left), image(right)])
      await headlineFontReady().catch(() => {})
      const ctx = canvas.current?.getContext('2d')
      if (cancelled || !ctx) return
      ctx.fillStyle = '#1b1b1f'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      const layout = layoutFormula(ctx, WIDTH, HEIGHT, { left: l, right: r }, line, look)
      drawFormula(ctx, layout, { left: l, right: r })
    })()
    return () => {
      cancelled = true
      for (const bitmap of opened) bitmap.close()
    }
  }, [left, right, line, look, load])

  return <canvas ref={canvas} className="formula-preview" width={WIDTH} height={HEIGHT} aria-label="How the hook looks on the videos" role="img" />
}

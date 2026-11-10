// Where the speech models' runtime comes from, for every worker that runs
// one. The plain WebAssembly build of the model runtime: the library
// defaults to its "asyncify" build, which exists to support WebGPU; nothing
// here uses WebGPU, and the plain build loaded in about half the memory
// (~630 MB against ~1150 MB). Fetched from the CDN, pinned to the installed
// version, so a version bump changes it in one place.

import { env } from '@huggingface/transformers'

export function pointRuntimeAtCdn(): void {
  const ortVersion = env.backends.onnx.versions?.web
  if (ortVersion && env.backends.onnx.wasm) {
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${base}ort-wasm-simd-threaded.mjs`,
      wasm: `${base}ort-wasm-simd-threaded.wasm`,
    }
  }
}

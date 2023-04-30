import type esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'

export const wasmPlugin = {
  name: 'wasm',
  setup(build: esbuild.PluginBuild) {
    // Resolve ".wasm" files to a path with a namespace
    // filter match yoga.wasm?module or hi.wasm
    build.onResolve({ filter: /\.wasm(\?module)?$/i }, (args) => {
      if (args.resolveDir === '') {
        return // Ignore unresolvable paths
      }
      return {
        path: (path.isAbsolute(args.path)
          ? args.path
          : path.join(args.resolveDir, args.path)
        ).replace(/\?module$/, ''),
        namespace: 'wasm-binary',
      }
    })

    // Virtual modules in the "wasm-binary" namespace contain the
    // actual bytes of the WebAssembly file. This uses esbuild's
    // built-in "binary" loader instead of manually embedding the
    // binary data inside JavaScript code ourselves.
    build.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args) => ({
      contents: await fs.readFile(args.path),
      loader: 'binary',
    }))
  },
}

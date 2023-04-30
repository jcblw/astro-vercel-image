import type { AstroIntegration } from 'astro'
import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'

const name = '@jcblw/astro-site-presets'

type ImageFormat = 'image/avif' | 'image/webp'

type RemotePattern = {
  protocol?: 'http' | 'https'
  hostname: string
  port?: string
  pathname?: string
}
interface AstroVercelImagesConfig {
  sizes: number[]
  domains: string[]
  remotePatterns?: RemotePattern[]
  minimumCacheTTL?: number // seconds
  formats?: ImageFormat[]
  dangerouslyAllowSVG?: boolean
  contentSecurityPolicy?: string
  middleware?: string
  serverlessFunctions?: string[]
}

let wasmPlugin = {
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

export const toAbsPath = (url: URL) => url.toString().replace('file://', '')

export const getVercelOutput = (root: URL) => new URL('./.vercel/output/', root)

export default function createIntegration(
  {
    middleware: middlewareFile,
    serverlessFunctions: serverlessFunctionsFiles,
    ...integrationConfig
  }: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  const directory = path.join(process.cwd(), './.vercel/output')
  let hasMiddleware = false
  let middlewarePath: URL | null = null
  let serverlessFunctions: {
    output: URL
    filePath: URL
    outputFile: URL
    configFile: URL
    extension: string
  }[] = []
  return {
    name,
    hooks: {
      'astro:config:setup': async ({ config, updateConfig }) => {
        if (config.output !== 'static') {
          throw new Error('This integration only works with static builds')
        }

        if (middlewareFile && middlewareFile.includes('.ts')) {
          throw new Error('Typescript middleware is not supported')
        }

        if (serverlessFunctionsFiles?.some((file) => file.includes('.ts'))) {
          throw new Error('Typescript edge functions are not supported')
        }

        if (middlewareFile) {
          middlewarePath = new URL(middlewareFile, config.srcDir)
          try {
            await fs.stat(middlewarePath)
            hasMiddleware = true
          } catch (e) {
            console.warn(e)
          }
        }

        if (serverlessFunctionsFiles) {
          serverlessFunctionsFiles.forEach((file) => {
            const extension = path.extname(file)
            const functionPath = `./functions/${file.replace(
              /\.js|\.mjs/,
              '.func'
            )}`
            const edgeFunctionFile = new URL(file, config.srcDir)
            const edgeFunctionOutput = new URL(
              functionPath,
              getVercelOutput(config.root)
            )
            const outputFile = new URL(
              `${functionPath}/index${extension}`,
              getVercelOutput(config.root)
            )
            const configFile = new URL(
              `${functionPath}/.vc-config.json`,
              getVercelOutput(config.root)
            )
            serverlessFunctions.push({
              filePath: edgeFunctionFile,
              output: edgeFunctionOutput,
              outputFile,
              configFile,
              extension,
            })
          })
        }

        const outDir = new URL('./static/', getVercelOutput(config.root))
        updateConfig({
          build: {
            format: 'directory',
          },
          outDir,
        })
      },
      'astro:build:done': async () => {
        let existingConfig: { images?: AstroVercelImagesConfig } = {}
        const configPath = path.resolve(directory, './config.json')
        try {
          existingConfig = JSON.parse(await fs.readFile(configPath, 'utf8'))
        } catch (e) {
          console.warn(e)
        }

        const newConfig = {
          version: 3,
          routes: [{ handle: 'filesystem' }],
          ...existingConfig,
          images: integrationConfig,
          ...(hasMiddleware
            ? {
                routes: [
                  {
                    src: '/(.*)',
                    middlewarePath: '_middleware',
                    continue: true,
                  },
                ],
              }
            : {}),
        }

        await fs.mkdir(directory, { recursive: true })

        if (hasMiddleware && middlewarePath) {
          await fs.mkdir(
            path.resolve(directory, './functions/_middleware.func'),
            { recursive: true }
          )
          await fs.writeFile(
            path.resolve(
              directory,
              './functions/_middleware.func/.vc-config.json'
            ),
            JSON.stringify(
              {
                runtime: 'edge',
                entrypoint: `index.js`,
              },
              null,
              2
            )
          )
          await fs.copyFile(
            middlewarePath,
            path.resolve(directory, './functions/_middleware.func/index.js')
          )
        }

        if (serverlessFunctions.length) {
          await fs.mkdir(path.resolve(directory, './functions'), {
            recursive: true,
          })
          await Promise.all(
            serverlessFunctions.map(
              async ({
                filePath,
                output,
                configFile,
                outputFile,
                extension,
              }) => {
                await fs.mkdir(output, { recursive: true })
                await fs.writeFile(
                  configFile,
                  JSON.stringify(
                    {
                      runtime: 'nodejs16.x',
                      handler: `index${extension}`,
                      launcherType: 'Nodejs',
                      shouldAddHelpers: true,
                    },
                    null,
                    2
                  )
                )
                await esbuild.build({
                  target: 'es2020',
                  platform: 'browser',
                  entryPoints: [toAbsPath(filePath)],
                  outfile: toAbsPath(outputFile),
                  allowOverwrite: true,
                  format: 'esm',
                  bundle: true,
                  minify: false,
                  plugins: [wasmPlugin],
                })
                // await fs.copyFile(filePath, outputFile)
              }
            )
          )
        }

        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2))
      },
    },
  }
}

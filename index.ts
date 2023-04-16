import type { AstroIntegration } from 'astro'
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
  edgeFunction?: string
}

export const getVercelOutput = (root: URL) => new URL('./.vercel/output/', root)

export default function createIntegration(
  {
    middleware: middlewareFile,
    edgeFunction: edgeFunctionFile,
    ...integrationConfig
  }: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  const directory = path.join(process.cwd(), './.vercel/output')
  let hasMiddleware = false
  let middlewarePath: URL | null = null
  let hasEdgeFunctions = false
  let edgeFunctionsPath: URL | null = null
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

        if (edgeFunctionFile && edgeFunctionFile.includes('.ts')) {
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

        if (edgeFunctionFile) {
          edgeFunctionsPath = new URL(edgeFunctionFile, config.srcDir)
          try {
            await fs.stat(edgeFunctionsPath)
            hasEdgeFunctions = true
          } catch (e) {
            console.warn(e)
          }
        }

        const outDir = new URL('./static/', getVercelOutput(config.root))
        updateConfig({
          // ...config,
          build: {
            ...config.build,
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
                entrypoint: 'index.js',
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

        if (hasEdgeFunctions && edgeFunctionsPath) {
          await fs.mkdir(path.resolve(directory, './functions/index.func'), {
            recursive: true,
          })
          await fs.writeFile(
            path.resolve(directory, './functions/index.func/.vc-config.json'),
            JSON.stringify(
              {
                runtime: 'edge',
                entrypoint: 'index.js',
              },
              null,
              2
            )
          )
          await fs.copyFile(
            edgeFunctionsPath,
            path.resolve(directory, './functions/index.func/index.js')
          )
        }

        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2))
      },
    },
  }
}

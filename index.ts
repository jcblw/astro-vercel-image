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
  edgeFunctions?: string[]
}

export const getVercelOutput = (root: URL) => new URL('./.vercel/output/', root)

export default function createIntegration(
  {
    middleware: middlewareFile,
    edgeFunctions: edgeFunctionFiles,
    ...integrationConfig
  }: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  const directory = path.join(process.cwd(), './.vercel/output')
  let hasMiddleware = false
  let middlewarePath: URL | null = null
  let edgeFunctions: {
    output: URL
    filePath: URL
    outputFile: URL
    configFile: URL
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

        if (edgeFunctionFiles?.some((file) => file.includes('.ts'))) {
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

        if (edgeFunctionFiles) {
          edgeFunctionFiles.forEach((file) => {
            const functionPath = `./functions/${file.replace('.js', '.func')}`
            const edgeFunctionFile = new URL(file, config.srcDir)
            const edgeFunctionOutput = new URL(
              functionPath,
              getVercelOutput(config.root)
            )
            const outputFile = new URL(
              `${functionPath}/index.js`,
              getVercelOutput(config.root)
            )
            const configFile = new URL(
              `${functionPath}/.vc-config.json`,
              getVercelOutput(config.root)
            )
            edgeFunctions.push({
              filePath: edgeFunctionFile,
              output: edgeFunctionOutput,
              outputFile,
              configFile,
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

        if (edgeFunctions.length) {
          await fs.mkdir(path.resolve(directory, './functions'), {
            recursive: true,
          })
          await Promise.all(
            edgeFunctions.map(
              async ({ filePath, output, configFile, outputFile }) => {
                await fs.mkdir(output, { recursive: true })
                await fs.writeFile(
                  configFile,
                  JSON.stringify(
                    {
                      runtime: 'nodejs16.x',
                      handler: 'index.js',
                      launcherType: 'Nodejs',
                      shouldAddHelpers: true,
                    },
                    null,
                    2
                  )
                )
                await fs.copyFile(filePath, outputFile)
              }
            )
          )
        }

        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2))
      },
    },
  }
}

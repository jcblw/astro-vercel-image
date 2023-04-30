import type { AstroIntegration } from 'astro'
import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { wasmPlugin } from './wasm-plugin'

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
  edgeFunctions?: string[]
}

type FunctionConfig = {
  output: URL
  filePath: URL
  outputFile: URL
  configFile: URL
  extension: string
}

enum FunctionType {
  Edge = 'edge',
  Serverless = 'serverless',
}

const RuntimeConfigs: Record<
  FunctionType,
  {
    runtime: 'nodejs16.x' | 'edge' // TODO: support more runtimes
    launcherType?: string
    shouldAddHelpers?: boolean
  }
> = {
  [FunctionType.Edge]: {
    runtime: 'edge',
  },
  [FunctionType.Serverless]: {
    runtime: 'nodejs16.x',
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
  },
}

export const toAbsPath = (url: URL) => url.toString().replace('file://', '')

export const getVercelOutput = (root: URL) => new URL('./.vercel/output/', root)

export const pushFunctionFiles =
  (files: FunctionConfig[], config: any) => (file: string) => {
    const extension = path.extname(file)
    const functionPath = `./functions/${file.replace(/\.js|\.mjs/, '.func')}`
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
    files.push({
      filePath: edgeFunctionFile,
      output: edgeFunctionOutput,
      outputFile,
      configFile,
      extension,
    })
  }

const createVercelFunctions = async (
  { directory, type }: { directory: string; type: FunctionType },
  fns: FunctionConfig[]
) => {
  await fs.mkdir(path.resolve(directory, './functions'), {
    recursive: true,
  })
  await Promise.all(
    fns.map(async ({ filePath, output, configFile, outputFile, extension }) => {
      await fs.mkdir(output, { recursive: true })
      await fs.writeFile(
        configFile,
        JSON.stringify(
          {
            ...(RuntimeConfigs[type] || RuntimeConfigs[FunctionType.Edge]),
            handler: `index${extension}`,
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
    })
  )
}

export default function createIntegration(
  {
    middleware: middlewareFile,
    serverlessFunctions: serverlessFunctionsFiles,
    edgeFunctions: edgeFunctionsFiles,
    ...integrationConfig
  }: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  const directory = path.join(process.cwd(), './.vercel/output')
  let hasMiddleware = false
  let middlewarePath: URL | null = null
  let serverlessFunctions: FunctionConfig[] = []
  let edgeFunctions: FunctionConfig[] = []
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
          serverlessFunctionsFiles.forEach(
            pushFunctionFiles(serverlessFunctions, config)
          )
        }

        if (edgeFunctionsFiles) {
          edgeFunctionsFiles.forEach(pushFunctionFiles(edgeFunctions, config))
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
          await createVercelFunctions(
            { directory, type: FunctionType.Serverless },
            serverlessFunctions
          )
        }

        if (edgeFunctions.length) {
          await createVercelFunctions(
            { directory, type: FunctionType.Edge },
            edgeFunctions
          )
        }

        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2))
      },
    },
  }
}

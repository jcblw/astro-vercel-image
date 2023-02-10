import type { AstroIntegration } from "astro";
import fs from "fs/promises";
import path from "path";

type ImageFormat = "image/avif" | "image/webp";

type RemotePattern = {
  protocol?: "http" | "https";
  hostname: string;
  port?: string;
  pathname?: string;
};

interface AstroVercelImagesConfig {
  sizes: number[];
  domains: string[];
  remotePatterns?: RemotePattern[];
  minimumCacheTTL?: number; // seconds
  formats?: ImageFormat[];
  dangerouslyAllowSVG?: boolean;
  contentSecurityPolicy?: string;
}

export const getVercelOutput = (root: URL) =>
  new URL("./.vercel/output/", root);

export default function createIntegration(
  config: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  const directory = path.join(process.cwd(), "./.vercel/output");
  return {
    name: "astro-vercel-image",
    hooks: {
      "astro:config:setup": async ({ config, updateConfig }) => {
        if (config.output !== "static") {
          throw new Error("This integration only works with static builds");
        }
        const outDir = new URL("./static/", getVercelOutput(config.root));
        updateConfig({
          build: {
            ...config.build,
            format: "directory",
          },
          outDir,
        });
      },
      "astro:build:done": async () => {
        let existingConfig: { images?: AstroVercelImagesConfig } = {};
        const configPath = path.resolve(directory, "./config.json");
        try {
          existingConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
        } catch (e) {
          // console.log(e);
        }
        const newConfig = {
          version: 3,
          routes: [{ handle: "filesystem" }],
          ...existingConfig,
          images: config,
        };

        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
      },
    },
  };
}

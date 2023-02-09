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

export default function createIntegration(
  config: AstroVercelImagesConfig = {
    sizes: [640, 750, 828, 1080, 1200],
    domains: [],
  }
): AstroIntegration {
  return {
    name: "astro-vercel-image",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        if (config.output === "static") {
          // This integration only works with static builds
          updateConfig({ outputDir: "./.vercel/output/static" });
        } else {
          throw new Error("This integration only works with static builds");
        }
      },
      "astro:build:done": async () => {
        let existingConfig: { images?: AstroVercelImagesConfig } = {};
        const directory = path.join(process.cwd(), "./.vercel/output");
        const configPath = path.join(directory, "./config.json");
        try {
          existingConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
        } catch (e) {
          console.log(e);
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

# Vercel Image Optimization for Astro

This is an integration for [Astro](https://astro.build) that adds support for [Vercel Image Optimization](https://vercel.com/docs/next.js/image-optimization). **Note:** This integration currently does not support using the Vercel Adapter, to do that please referance the [Vercel Image Optimization blog](https://jcbl.ws/astro-vercel-image-optimization) for more info.

## Installation

```bash
npm install astro-vercel-image
```

## Usage

There is two things to setup with this integration, the first is to add the `astro-vercel-image` plugin to your `astro.config.mjs` file. See [Vercel Image Optimization Docs](https://vercel.com/docs/build-output-api/v3#build-output-configuration/supported-properties/images) for more info on the options.

```js
export default {
  integrations: [
    vercelImages({
      sizes: [640, 750, 828, 1080, 1200],
      domains: [],
      minimumCacheTTL: 60,
      formats: ["image/avif", "image/webp"],
      remotePatterns: [
        {
          protocol: "https",
          hostname: "^avatars1\\.githubusercontent\\.com$",
          pathname: "^/u/578259",
        },
      ],
    }),
  ],
};
```

The second thing to do is import the `VercelImage` component from `astro-vercel-image/VercelImage.astro` and use it in your components. **Note:** The `VercelImage` component width needs to in the list of `sizes` in the `astro.config.mjs` file.

```astro
---
import VercelImage from "astro-vercel-image/VercelImage.astro";
---

<div>
  <VercelImage src="/cat-image.jpg" alt="A photo of a cat" width={640} />
</div>
```

## License

[MIT](LICENSE)

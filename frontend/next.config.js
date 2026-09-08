/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // No `rewrites()` here on purpose. With `output: 'standalone'` Next serialises
  // rewrite destinations into the build, so `API_PROXY_TARGET` would be frozen
  // at whatever it was during `docker build` -- which left the container unable
  // to reach the API at all. The forwarding lives in route handlers
  // (`src/app/api/[...path]/route.ts`) that read the environment per request.
};

module.exports = nextConfig;

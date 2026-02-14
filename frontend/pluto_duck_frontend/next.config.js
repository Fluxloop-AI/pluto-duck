/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
  // Optional override for local diagnostics; default flow is same-origin API.
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || '',
  },
};

module.exports = nextConfig;

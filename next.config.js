// ─── Windows EISDIR readlink fix ─────────────────────────────────────────────
require('./patch-readlink.cjs')
// ─────────────────────────────────────────────────────────────────────────────

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',       value: 'on' },
  { key: 'X-Content-Type-Options',       value: 'nosniff' },
  { key: 'X-Frame-Options',             value: 'SAMEORIGIN' },
  { key: 'X-XSS-Protection',            value: '1; mode=block' },
  { key: 'Referrer-Policy',             value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',          value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security',   value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs', 'mongoose'],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  ...(process.env.TURBOPACK ? {} : {
    webpack: (config, { isServer }) => {
      config.externals = [...(config.externals || []), { canvas: 'canvas' }]
      config.snapshot = {
        ...(config.snapshot ?? {}),
        managedPaths: [],
        immutablePaths: [],
      }
      return config
    },
  }),
}

module.exports = nextConfig

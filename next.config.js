// ─── Windows EISDIR readlink fix ─────────────────────────────────────────────
require('./patch-readlink.cjs')
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('next').NextConfig} */
const nextConfig = {
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

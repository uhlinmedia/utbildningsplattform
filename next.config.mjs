/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
  serverExternalPackages: ['exceljs', 'pdf-lib', '@pdf-lib/fontkit', 'sharp'],
  // Filer som läses från disk vid körning och därför måste följa med till servern.
  outputFileTracingIncludes: {
    '/**': ['./db/migrations/*.sql'],
    '/certifikat/**': ['./lib/fonts/*.ttf'],
    '/admin/certifikat': ['./lib/fonts/*.ttf'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Förhandsvisningen av certifikat visas i en ram i adminsidorna.
        source: '/admin/certifikat',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ];
  },
};
export default nextConfig;

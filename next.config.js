/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 빌드 시 ESLint 경고 무시 (배포 차단 방지)
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig

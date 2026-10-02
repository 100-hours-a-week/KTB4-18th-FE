import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
// 10.02 센트리 추가
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // 10.02 센트리 추가: 빌드용 인증 정보가 있을 때만 소스맵 업로드 활성화
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN;
  const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT;
  const uploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);

  return {
    plugins: [
      react(),
      tailwindcss(),
      // 10.02 센트리 추가: 소스맵을 업로드하고 배포 폴더의 .map 파일 삭제
      ...(uploadSourceMaps
        ? [
            sentryVitePlugin({
              authToken: sentryAuthToken,
              org: sentryOrg,
              project: sentryProject,
              telemetry: false,
              release: { name: env.VITE_SENTRY_RELEASE || undefined },
              sourcemaps: {
                assets: './dist/**',
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
            }),
          ]
        : []),
    ],
    // 10.02 센트리 추가: 업로드 설정이 없으면 소스맵을 생성하지 않음
    build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});

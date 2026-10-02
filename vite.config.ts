import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN;
  const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT;
  const uploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);

  return {
    plugins: [
      react(),
      tailwindcss(),
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

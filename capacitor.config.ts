import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flipflip.app',
  appName: 'FlipFlip',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Media elements on Android point at a native loopback HTTP server
    // (flipflip-transcoder media server) because the WebView media stack
    // cannot reliably range-read moov-at-end containers through Capacitor's
    // local interceptor. This page is https://localhost, so the http://127.0.0.1
    // media srcs are mixed content and must be permitted.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    // Let the OS + WebView handle window insets instead of Capacitor's
    // SystemBars interceptor. On Android the default "css" handler zeros the
    // IME out of the insets returned to the WebView, so the layout viewport
    // never resizes and the soft keyboard paints grey over the UI. With
    // "disable" + windowSoftInputMode=adjustResize the window actually resizes
    // (innerHeight shrinks -> --app-height) and WebView >=144 supplies
    // env(safe-area-inset-*) natively (fallbacks already in the CSS). iOS has
    // no SystemBars plugin and is unaffected by this key.
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
};

export default config;

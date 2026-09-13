import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flipflip.app',
  appName: 'FlipFlip',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
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

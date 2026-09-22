// Put all your custom type information for 3rd party modules here
declare module '*.svg' {
  const value: any;
  export = value;
}

declare module '*.png' {
  const value: any;
  export = value;
}

declare module '*.ico' {
  const value: any;
  export = value;
}

declare module '*.icns' {
  const value: any;
  export = value;
}

declare module "@mui/material/Slider/ValueLabel"
declare module 'd3-ease';
declare module 'gif-info';
declare module 'react-color';
declare module 'react-select';
declare module 'react-select/creatable';
declare module 'react-spring';
declare module 'react-virtualized-auto-sizer';
declare module 'react-window';
declare module 'uuid/v4';
declare module 'web-audio-beat-detector';
declare module '@xmldom/xmldom';


// Type declarations for Clipboard API
// https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
interface Clipboard {
  writeText(newClipText: string): Promise<void>;
  // Add any other methods you need here.
}

interface NavigatorClipboard {
  // Only available in a secure context.
  readonly clipboard?: Clipboard;
}

interface Navigator extends NavigatorClipboard {}
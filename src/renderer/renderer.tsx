(window as any).setImmediate = (window as any).setImmediate || ((fn: Function, ...args: any[]) => setTimeout(fn, 0, ...args));

// Some libraries (e.g. react-draggable) reference `process.env` unguarded at
// runtime. Electron provides `process`; a mobile WebView does not. The define
// below is a backstop so bare platform/state reads don't crash the app.
const processShim = { env: {}, platform: 'web', type: 'renderer', nextTick: (fn: Function, ...args: any[]) => setTimeout(fn, 0, ...args) };
(window as any).process = (window as any).process || processShim;

import { setAutoFreeze } from "immer";
setAutoFreeze(false);

import * as React from 'react';
import {createRoot} from 'react-dom/client';

import {initPlatform} from './services/platform';
import {initViewportHeight} from './services/viewport';
import Meta from './components/Meta';
import './style.css';

initPlatform();
initViewportHeight();

const root = createRoot(document.getElementById('app')!);
root.render(<Meta/>);
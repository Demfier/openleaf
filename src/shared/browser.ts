// Cross-browser WebExtension API namespace.
//
// Firefox and Safari expose the standards-track, promise-based `browser`
// global. Chrome, Edge, and Opera expose `chrome` (also promise-based under
// Manifest V3). Preferring `browser` when present gives us promise semantics
// everywhere while reusing the existing @types/chrome typings, so every call
// site can stay `await`-friendly without a runtime polyfill dependency.
//
// Page-context scripts (e.g. page-bridge.ts) must NOT import this — they run in
// the page's world, which has no extension APIs.
const globals = globalThis as unknown as {
  browser?: typeof chrome
  chrome?: typeof chrome
}

export const browser: typeof chrome = globals.browser ?? (globals.chrome as typeof chrome)

// Vite / Electron-vite env type shims
/// <reference types="vite/client" />

interface Window {
  windowControls: {
    minimize: () => void
    maximize: () => void
    close:    () => void
  }
}

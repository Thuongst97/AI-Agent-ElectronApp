/**
 * Preload script — the security bridge between renderer and main.
 *
 * Rules:
 *  - Only expose what the renderer NEEDS through contextBridge.
 *  - Validate / sanitize all inputs before forwarding via ipcRenderer.
 *  - Never leak raw ipcRenderer / require / __dirname to the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ElectronAPI,
  ChatRequest,
  ChatChunk,
  AppSettings,
  IngestResult,
  AppStatus,
  ConversationMeta,
  Message,
} from '../shared/ipc-types'
import { IPC } from '../shared/ipc-types'

const api: ElectronAPI = {
  // ── Chat ──────────────────────────────────────────────────────────────────
  sendMessage: (req: ChatRequest) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, req),

  onChatChunk: (cb: (chunk: ChatChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: ChatChunk) => cb(chunk)
    ipcRenderer.on(IPC.CHAT_CHUNK, handler)
    // Return a cleanup function
    return () => ipcRenderer.removeListener(IPC.CHAT_CHUNK, handler)
  },

  resetChat: (conversationId: string) =>
    ipcRenderer.invoke(IPC.CHAT_RESET, conversationId),

  cancelMessage: () =>
    ipcRenderer.invoke(IPC.CHAT_CANCEL),

  // ── History ───────────────────────────────────────────────────────────────
  listHistory: (): Promise<ConversationMeta[]> =>
    ipcRenderer.invoke(IPC.HISTORY_LIST),

  getHistory: (id: string): Promise<Message[]> =>
    ipcRenderer.invoke(IPC.HISTORY_GET, id),

  deleteHistory: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.HISTORY_DELETE, id),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_GET),

  setSettings: (partial: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, partial),

  // ── Data ──────────────────────────────────────────────────────────────────
  ingestData: (filePath: string): Promise<IngestResult> =>
    ipcRenderer.invoke(IPC.DATA_INGEST, filePath),

  // ── Status ────────────────────────────────────────────────────────────────
  getStatus: (): Promise<AppStatus> =>
    ipcRenderer.invoke(IPC.STATUS_GET),
}

// Expose under window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', api)

// ── Window controls (custom frameless title bar) ──────────────────────────────
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
})

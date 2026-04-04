# Components Reference

## Renderer Architecture

```
App.tsx  (root layout + view routing)
├── TitleBar.tsx
├── HistoryView.tsx  (left sidebar)
└── <current view>
    ├── ChatView.tsx   +  InputBar.tsx
    └── SettingsView.tsx
```

---

## Views

### `ChatView.tsx`

**Purpose:** Renders the full conversation thread with streaming support.

**Key behaviors:**

- Subscribes to `chatStore.messages` — re-renders on every token chunk
- `tool_call` chunks render as collapsible tool-call cards
- `error` chunks render in red
- Auto-scrolls to bottom on new messages
- Shows a loading spinner while `isLoading === true`

**Props:** none (reads from `chatStore`)

---

### `HistoryView.tsx`

**Purpose:** Collapsible left sidebar showing past conversations.

**Props:**
| Prop | Type | Description |
|---|---|---|
| `collapsed` | `boolean` | Controls 44px strip vs 224px expanded mode |
| `onToggle` | `() => void` | Callback to toggle collapse state (lifted to App.tsx) |
| `onSettings` | `() => void` | Callback to navigate to SettingsView |

**Collapsed mode (44px):**

- `›` expand chevron (top)
- `+` new chat icon (middle)
- `⚙` settings gear (bottom)

**Expanded mode (224px):**

- Header: New Chat button + `‹` collapse chevron
- Scrollable conversation list
- Settings button pinned to bottom

**Transition:** `width: collapsed ? '44px' : '224px'` — CSS `200ms ease`

---

### `SettingsView.tsx`

**Purpose:** Configuration panel for LLM, ChromaDB, theme, and data ingestion.

**Sections:**

1. **LLM Settings** — Base URL, Model picker (uses `MODEL_GROUPS` from constants), Max tokens, Temperature
2. **GitHub Token** — Password input, value masked as `__masked__` from main
3. **ChromaDB** — Host, Port
4. **Theme** — light / dark / system
5. **Data Ingestion** — File picker + ingest button + result display

**Reads/writes:** `settingsStore` (Zustand) which proxies to `window.electronAPI`

---

## Components

### `TitleBar.tsx`

**Purpose:** Custom frameless title bar with drag region and window controls.

**Layout:**

```
[drag region — app name "Mimi"]  [— □ ✕]
```

**Uses:** `window.windowControls.{ minimize, maximize, close }` exposed by preload

**CSS:** `-webkit-app-region: drag` on container; `no-drag` on buttons

---

### `InputBar.tsx`

**Purpose:** Unified chat input box — single container with textarea and toolbar.

**Layout (inside `.input-box`):**

```
┌──────────────────────────────────────────────────┐
│  textarea (auto-grows, rows=1, max 160px)        │
│                                                  │
│  ⬡ GPT-4o ∨ · · · · · · · · · · · · · · [→]   │
└──────────────────────────────────────────────────┘
```

**Model picker:**

- VSCode-style pill button — shows active model label
- Opens an upward dropdown listing `MODEL_GROUPS` (OpenAI + Anthropic)
- Closes on outside click (via `useEffect` + `mousedown`)
- Saves via `settingsStore.saveSettings({ llmModel })`

**Send button:**

- Positioned at far right of toolbar row
- Dark filled `h-8 w-8 rounded-lg` — uses `var(--text-primary)` as background
- Arrow SVG icon; spinner when `isLoading`
- Disabled (opacity 0.4) when textarea is empty or loading

**Key handlers:**

- `Enter` → send; `Shift+Enter` → newline
- `onInput` → auto-resize textarea height (up to 160px)

---

## Zustand Stores

### `chatStore.ts`

```typescript
interface ChatState {
  messages: Message[]
  isLoading: boolean
  conversationId: string

  sendMessage: (text: string) => Promise<void>
  resetChat: () => Promise<void>
  loadConversation: (id: string) => Promise<void>
  setMessages: (msgs: Message[]) => void
}
```

**`sendMessage` flow:**

1. Appends user `Message` to `messages`
2. Sets `isLoading = true`
3. Registers `onChatChunk` listener
4. Calls `window.electronAPI.sendMessage(req)`
5. On each `token` chunk: appends/extends last assistant message
6. On `tool_call` / `tool_result`: inserts tool message cards
7. On `final` or `error`: sets `isLoading = false`, removes listener

---

### `settingsStore.ts`

```typescript
interface SettingsState {
  settings: AppSettings
  loadSettings: () => Promise<void>
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
}
```

- `loadSettings` called on app mount from `App.tsx`
- `saveSettings` merges partial into local state then calls `window.electronAPI.setSettings`

---

## Constants

### `constants/models.ts`

```typescript
export const MODEL_GROUPS: { group: string; models: { label: string; value: string }[] }[]
export function modelLabel(value: string): string // returns display label or value
export const ALL_KNOWN_VALUES: string[] // all non-custom model values
export const CUSTOM_SENTINEL = 'custom'
```

**Groups:**

- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o1-mini`, `o3-mini`
- **Anthropic:** `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`

---

## CSS Architecture

All global styles are in `src/renderer/src/styles/globals.css` using Tailwind `@layer components`.

### CSS Custom Properties (Theme Variables)

Set on `<html data-theme="dark|light">` by `App.tsx`:

| Variable          | Usage                             |
| ----------------- | --------------------------------- |
| `--bg-primary`    | Main window background            |
| `--bg-secondary`  | Panel / sidebar background        |
| `--surface`       | Input box, cards                  |
| `--surface-hover` | Hover state for buttons           |
| `--border`        | All borders                       |
| `--text-primary`  | Main text                         |
| `--text-muted`    | Secondary text                    |
| `--text-faint`    | Placeholders, very secondary      |
| `--accent`        | Focus rings, active states, links |
| `--tool-bg`       | Tool call card background         |

### Key CSS Classes

| Class                 | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `.input-box`          | Unified chat input container (border + focus-within ring) |
| `.input-box textarea` | Transparent textarea inside input box                     |
| `.input-bar`          | Legacy standalone input (kept for compatibility)          |
| `.btn-primary`        | Filled accent button                                      |
| `.sidebar-item`       | Sidebar navigation item with hover state                  |
| `.msg-user`           | User message bubble                                       |
| `.msg-assistant`      | Assistant message bubble                                  |
| `.tool-card`          | Tool call / result card                                   |

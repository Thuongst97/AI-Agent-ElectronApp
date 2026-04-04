# AI Agent — Documentation

A desktop AI assistant built with **Electron 30 + TypeScript 5 + React 18**, powered by GitHub Copilot LLM and ChromaDB vector memory. The agent understands telecom system requirements and can search, analyze, and generate test cases from an embedded knowledge base.

---

## Table of Contents

| Document                                       | Description                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| [architecture.md](./architecture.md)           | Process model, module map, dependency graph          |
| [data-flow.md](./data-flow.md)                 | How data moves through the system (Mermaid diagrams) |
| [sequence-diagrams.md](./sequence-diagrams.md) | End-to-end interaction sequences                     |
| [components.md](./components.md)               | Renderer React components & Zustand stores           |
| [ipc-contract.md](./ipc-contract.md)           | Full IPC channel reference                           |

---

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload for both main + renderer)
npm run dev
```

### Build & Package

```bash
# Windows installer (.exe)
npm run package:win

# macOS disk image (.dmg) — must run on macOS
npm run package:mac

# Linux AppImage
npm run package:linux

# Regenerate app icons
npm run gen-icons
```

### Environment

Copy `.env.example` to `.env` and fill in:

```env
GITHUB_TOKEN=ghp_...        # GitHub personal access token (Copilot access)
CHROMA_HOST=localhost        # ChromaDB host (optional, falls back to Vectra)
CHROMA_PORT=8000
```

---

## Tech Stack

| Layer            | Technology                                                |
| ---------------- | --------------------------------------------------------- |
| Desktop shell    | Electron 30                                               |
| Build tooling    | electron-vite 2, Vite 5                                   |
| Language         | TypeScript 5 (strict)                                     |
| Renderer UI      | React 18, Tailwind CSS 3                                  |
| State management | Zustand 4                                                 |
| LLM client       | LangChain + `@langchain/openai` (GitHub Copilot endpoint) |
| Vector memory    | ChromaDB (primary) → Vectra (fallback)                    |
| Packaging        | electron-builder 24                                       |
| Logging          | electron-log                                              |

---

## Project Structure

```
AI-Agent-ElectronApp/
├── src/
│   ├── main/                  # Node.js main process
│   │   ├── index.ts           # App entry, BrowserWindow creation
│   │   ├── ipc/handler.ts     # All ipcMain.handle() registrations
│   │   ├── agent/             # LLM orchestration core
│   │   ├── data/              # Vector memory & data ingestion
│   │   ├── services/          # Settings, Conversations (file persistence)
│   │   └── tools/             # Tool definitions for function calling
│   ├── preload/index.ts       # contextBridge security bridge
│   ├── renderer/src/          # React renderer (zero Node.js)
│   │   ├── App.tsx            # Root layout, view routing
│   │   ├── views/             # Full-page views
│   │   ├── components/        # Shared UI components
│   │   ├── store/             # Zustand stores
│   │   └── constants/         # Shared constants (models, etc.)
│   └── shared/ipc-types.ts    # Shared TypeScript types & IPC channel names
├── resources/                 # App icons
├── docs/                      # ← You are here
├── scripts/                   # Build helpers (icon generator)
├── electron-builder.yml       # Packaging configuration
└── .github/workflows/         # CI/CD (multi-platform release)
```

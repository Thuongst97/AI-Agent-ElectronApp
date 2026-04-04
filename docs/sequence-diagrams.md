# Sequence Diagrams

## 1. User Sends a Chat Message (No Tools)

```mermaid
sequenceDiagram
    actor User
    participant InputBar
    participant chatStore
    participant preload as Preload (contextBridge)
    participant handler as ipc/handler.ts
    participant Agent as AgentService
    participant Gate as SemanticGate
    participant Mem as MemoryService
    participant LLM as LLMService

    User->>InputBar: types message + presses Enter
    InputBar->>chatStore: sendMessage(text)
    chatStore->>preload: window.electronAPI.sendMessage(req)
    preload->>handler: ipcRenderer.invoke("chat:send", req)

    handler->>Agent: agent.chat(req, onChunk)
    Agent->>Gate: validate(message)
    Gate-->>Agent: PASS

    Agent->>Mem: buildMessages(conversationId)
    Mem-->>Agent: [systemPrompt, ...history, userMsg]

    Agent->>LLM: streamChat(messages, onChunk)
    loop streaming tokens
        LLM-->>handler: onChunk({ type:"token", content:"..." })
        handler->>preload: win.webContents.send("chat:chunk", chunk)
        preload->>chatStore: onChatChunk callback
        chatStore->>InputBar: re-render ChatView with new token
    end

    LLM-->>handler: onChunk({ type:"final", content:"" })
    handler->>Mem: persist(conversationId, assistantMsg)
    handler->>chatStore: (final chunk triggers isLoading=false)
```

---

## 2. User Sends a Message (Tool Calling)

```mermaid
sequenceDiagram
    participant Agent as AgentService
    participant LLM as LLMService
    participant TR as ToolRegistry
    participant Tool as SearchRequirementsTool
    participant VDB as VectorMemoryService

    Note over Agent,VDB: After SemanticGate passes and messages are built...

    Agent->>LLM: streamChat(messages, onChunk)
    LLM-->>Agent: tool_call: { name:"SearchRequirements", input:{query:"..."} }

    Agent->>Agent: emit chunk { type:"tool_call", toolName, content }
    Agent->>TR: run("SearchRequirements", input)
    TR->>Tool: execute(input)
    Tool->>VDB: search(query, topK=5)
    VDB-->>Tool: [{ content, metadata, score }]
    Tool-->>TR: formatted result string
    TR-->>Agent: tool result

    Agent->>Agent: emit chunk { type:"tool_result", toolName, content }
    Agent->>LLM: streamChat([...messages, toolMsg], onChunk)
    loop final answer tokens
        LLM-->>Agent: token chunks
        Agent-->>Agent: emit { type:"token" } chunks
    end
    LLM-->>Agent: { type:"final" }
```

---

## 3. App Startup

```mermaid
sequenceDiagram
    participant OS
    participant Main as main/index.ts
    participant Handler as ipc/handler.ts
    participant Settings as SettingsService
    participant VDB as VectorMemoryService
    participant Ingester as DataIngester
    participant TR as ToolRegistry
    participant LLM as LLMService
    participant Renderer

    OS->>Main: launch app
    Main->>Main: requestSingleInstanceLock()
    Main->>Main: loadDotenv()
    Main->>Main: createWindow()
    Main->>Handler: registerIpcHandlers(win)

    Handler->>Settings: new SettingsService() — load from userData
    Handler->>LLM: new LLMService(settings)
    Handler->>VDB: new VectorMemoryService()
    Handler->>VDB: init()

    alt ChromaDB reachable
        VDB-->>Handler: connected
    else fallback
        VDB-->>Handler: using Vectra
    end

    Handler->>VDB: totalCount()
    alt collection empty
        Handler->>Ingester: ingestDirectory(seedDir)
        Ingester-->>Handler: { inserted, skipped, errors }
    end

    Handler->>TR: new ToolRegistry(vectorMemory)
    Handler->>TR: agent.setToolRegistry(registry)

    par async probe
        Handler->>LLM: probe()
        LLM-->>Handler: 'connected' | 'error'
    end

    Main->>Renderer: ready-to-show → show window
    Renderer->>Handler: ipc: settings:get
    Handler-->>Renderer: AppSettings (token masked)
    Renderer->>Handler: ipc: status:get
    Handler-->>Renderer: { llm, chromadb, version }
```

---

## 4. Settings Update

```mermaid
sequenceDiagram
    actor User
    participant SettingsView
    participant settingsStore
    participant Handler as ipc/handler.ts
    participant SettingsService
    participant LLM as LLMService

    User->>SettingsView: changes model / token / URL
    SettingsView->>settingsStore: saveSettings(partial)
    settingsStore->>Handler: window.electronAPI.setSettings(partial)
    Handler->>SettingsService: set(partial)
    SettingsService->>SettingsService: encrypt token via safeStorage
    SettingsService-->>Handler: saved

    Handler->>LLM: updateSettings(newSettings)
    LLM->>LLM: rebuild ChatOpenAI client
    Handler->>LLM: probe()
    LLM-->>Handler: connectionState
    Handler->>SettingsView: (next status:get returns updated state)
```

---

## 5. Conversation History Navigation

```mermaid
sequenceDiagram
    actor User
    participant HistoryView
    participant chatStore
    participant Handler as ipc/handler.ts
    participant ConvService as ConversationService

    User->>HistoryView: clicks conversation in sidebar
    HistoryView->>chatStore: loadConversation(id)
    chatStore->>Handler: window.electronAPI.getHistory(id)
    Handler->>ConvService: getMessages(id)
    ConvService-->>Handler: Message[]
    Handler-->>chatStore: Message[]
    chatStore-->>HistoryView: messages set, view switches to ChatView

    User->>HistoryView: clicks delete icon
    HistoryView->>Handler: window.electronAPI.deleteHistory(id)
    Handler->>ConvService: deleteConversation(id)
    ConvService->>ConvService: unlink JSON file
    HistoryView->>Handler: window.electronAPI.listHistory()
    Handler-->>HistoryView: updated ConversationMeta[]
```

---

## 6. Data Ingestion

```mermaid
sequenceDiagram
    actor User
    participant SettingsView
    participant Handler as ipc/handler.ts
    participant Ingester as DataIngester
    participant VDB as VectorMemoryService

    User->>SettingsView: selects file + clicks Ingest
    SettingsView->>Handler: window.electronAPI.ingestData(filePath)
    Handler->>Ingester: ingestFile(filePath)
    Ingester->>Ingester: read + parse CSV/JSON
    loop each requirement chunk
        Ingester->>VDB: upsert(id, text, metadata)
    end
    Ingester-->>Handler: { success, inserted, skipped, errors }
    Handler->>VDB: probe() — refresh chromadb state
    Handler-->>SettingsView: IngestResult
    SettingsView-->>User: show result summary
```

# AI Agent System — Architecture & Design

> This document outlines the architecture of the AI agent core, focusing on its orchestration, tool management, and prompt engineering strategies.

---

## 1. Overview

The agent system is designed to be a powerful, tool-using assistant integrated into a desktop application. It leverages the GitHub Copilot SDK for its core reasoning loop but also supports a more advanced LangGraph-based orchestrator for complex tasks. The architecture is modular, allowing for easy extension with new tools and skills.

```
┌──────────────────────────┐
│       Main Process       │
│  (ipc/handler.ts)        │
└────────────┬─────────────┘
             │ IPC: chat:send
             ▼
┌──────────────────────────┐
│  Agent Orchestrator      │
│ ┌──────────────────────┐ │
│ │ CopilotAgentService  │ │  ←──┐ (default)
│ └──────────────────────┘ │     │
│ ┌──────────────────────┐ │     │ toggle via
│ │ LangGraphAgentService│ │  ←──┘ settings
│ └──────────────────────┘ │
└────────────┬─────────────┘
             │ uses
             ▼
┌──────────────────────────┐
│  ToolRegistry            │
│  (tools/ToolRegistry.ts) │
└────────────┬─────────────┘
      ┌──────┴──────┐
      │             │
┌─────▼─────┐ ┌─────▼─────┐
│ jiraTools │ │ reqTools  │
└─────┬─────┘ └─────┬─────┘
      │             │
┌─────▼─────┐ ┌─────▼─────┐
│ JiraService │ │ VectorMem │
└───────────┘ └───────────┘
```

---

## 2. Core Components

### 2.1. Agent Orchestrator

The system employs a dual-orchestrator strategy, controlled by the `useReasoningGraph` setting. This allows for selecting the best reasoning engine for the task.

- **`CopilotAgentService` (Default)**: This is the primary orchestrator, built on the `@github/copilot-sdk`. It handles the entire agentic loop: receiving a prompt, planning which tools to use, executing them, and synthesizing a final answer. It is robust, efficient, and ideal for most standard tool-calling scenarios. Its behavior is guided by a dynamic system prompt.

- **`LangGraphAgentService` (Experimental)**: This orchestrator uses LangGraph.js to define the agent's reasoning process as an explicit state machine (a graph). This is more powerful for tasks requiring complex, multi-step logic, reflection, or cycles. It offers fine-grained control at the cost of increased complexity.

Both orchestrators are self-contained and share the same set of tools via the `ToolRegistry`.

### 2.2. Tool Registry & Tools

- **`ToolRegistry`**: This class acts as a central repository for all tools the agent can use. It is initialized with core tools (like Jira) and can be dynamically updated with more tools as their dependencies (like the Vector DB) become available. This lazy-loading approach ensures the agent starts quickly.

- **Tools (`/tools/*.ts`)**: Tools are the agent's atomic capabilities. They are defined using the Copilot SDK's `defineTool` function. Key design principles for tools are:
  - **Clear Descriptions**: The `description` field is crucial for the LLM to decide when to use the tool.
  - **Graceful Error Handling**: Handlers `try...catch` errors and return a descriptive string instead of throwing. This prevents the entire agent turn from failing.
  - **Pre-formatted Output**: Tools often return pre-formatted Markdown (e.g., tables). This offloads formatting work from the LLM, saving tokens and improving reliability.

---

## 3. Key Design Concepts

### 3.1. Tools vs. Skills: A Powerful Abstraction

The agent's behavior is defined by two distinct but related concepts:

- **Tools**: **Imperative capabilities.** These are the concrete functions the agent can execute, like `get_ticket_details`. They are implemented as code and registered in the `ToolRegistry`. They represent _what_ the agent can do.

- **Skills**: **Declarative strategies.** These are natural language instructions injected into the system prompt that guide the agent on _how_ to use its tools to accomplish a higher-level task. For example, the `jira_analysis` skill (defined in `renderer/src/constants/skills.ts`) provides a step-by-step playbook for analyzing a ticket, combining `get_ticket_details` and `search_requirements`.

This separation allows for modifying the agent's strategic behavior by simply editing prompt text in the "Skills" configuration, without changing any code.

### 3.2. Dynamic Prompt Engineering

The system prompt is not static. It is constructed on-the-fly by `CopilotAgentService` for each session, combining several parts:

1.  **Base System Prompt**: A foundational instruction set defining the agent's core persona and purpose.
2.  **Skills Section**: Enabled skills (from user settings) are appended, providing specific task strategies.
3.  **Semantic Gate Addendum**: A small instruction that encourages the agent to ask for clarification if the user's query is ambiguous, avoiding a separate pre-processing LLM call.

### 3.3. Robust Session Management

Agent state and conversation history are managed by the Copilot SDK's `infiniteSessions` feature, which persists session data to disk. A critical piece of our design is the `purgeStaleSessionsIfNeeded` function in `CopilotAgentService`.

- It computes a **fingerprint** (a hash) of the current tool configuration and system prompt.
- On startup, it compares this fingerprint to a stored value.
- If they differ (meaning tools or prompts have changed), it **deletes all cached SDK session data**.

This is vital for stability. It ensures that the agent always creates fresh plans with the latest tools and instructions, preventing it from using outdated, cached reasoning that would lead to errors.

---

## 4. Data Flow (CopilotAgentService)

A typical user interaction follows this sequence:

1.  User sends a message from the UI (`ChatView`).
2.  The `ipc/handler` receives the `chat:send` event.
3.  It routes the request to `CopilotAgentService.chat()`.
4.  The service calls `_getOrCreateSession()`, which either resumes a session from disk or creates a new one with the dynamically-built system prompt and the full toolset from `ToolRegistry`.
5.  The service subscribes to SDK events (`assistant.message_delta`, `tool.execution_start`, etc.) and forwards them as `ChatChunk`s over IPC to the UI for real-time display.
6.  It calls `session.sendAndWait({ prompt: message })`, handing control over to the Copilot SDK.
7.  The SDK's agentic loop runs:
    - It plans which tool(s) to call based on the prompt and tool descriptions.
    - It emits `tool.execution_start` (UI shows a badge).
    - It invokes the tool's handler function.
    - It emits `tool.execution_complete` (UI can show the result).
    - It synthesizes the tool output into a natural language response.
    - It streams the final response via `assistant.message_delta` events.
8.  When the turn is complete, `sendAndWait` resolves. The service sends a `final` chunk and persists the full turn to `ConversationService` for the UI's history panel.

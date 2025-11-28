# Extension Architecture

## Overview

This browser extension enables users to download bank statements from supported financial institutions. The architecture uses a **Background Service Worker** as a persistent coordination layer between the ephemeral popup UI and tab-specific content scripts:

```
┌─────────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│                 │         │                      │         │                  │
│     Popup       │◄────────│  Background Service  │◄────────│  Content Script  │
│   (Ephemeral)   │────────►│  Worker (Persistent) │────────►│   (Per Tab)      │
│                 │         │                      │         │                  │
└─────────────────┘         └──────────────────────┘         └──────────────────┘
       ▲                              ▲                              ▲
       │                              │                              │
       │                              │                              │
       └──────────────────────────────┴──────────────────────────────┘
                        chrome.storage.session
                       (Shared Session Cache)
```

## Components

### 1. Background Service Worker (`extension/background.mjs`)

The background service worker is the heart of the extension, providing persistent state and coordination:

**Core Responsibilities:**

- **Request routing** - Acts as message broker between popup and content scripts
- **Cache management** - Maintains `chrome.storage.session` cache with 15-minute TTL
- **CORS proxy** - Handles cross-origin fetch requests that content scripts cannot make directly
- **Session persistence** - Preserves state across popup close/reopen cycles

**Caching Strategy:**

- Hierarchical cache keys: `cached_{action}_{bankId}_{sessionId}_{accountId?}`
- Automatic expiration after 15 minutes
- Force refresh support via `forceRefresh` flag
- Cache survives popup lifecycle but clears on browser session end

**Message Handling:**

- `getBankId` / `getSessionId` - Retrieve bank context from content script
- `getAccounts` - Fetch and cache account list
- `getStatements` - Fetch and cache statements per account
- `downloadStatement` - Proxy statement PDF download
- `clearCache` - Invalidate all cached data
- `requestFetch` - Handle cross-origin requests for content scripts

### 2. Popup (`extension/popup.mjs`)

The popup provides the user interface for viewing accounts and downloading statements:

**Responsibilities:**

- **UI rendering** - Display account list and statements in expandable panels
- **User interaction** - Handle clicks, downloads, and refresh actions
- **Message passing** - Communicate with background worker via `chrome.runtime.sendMessage`
- **Error handling** - Display user-friendly error messages

**Lifecycle:**

- Opens when user clicks extension icon
- Loads cached data instantly from background worker
- Closes when user clicks away (state preserved in background)
- No local caching or fetch logic - fully delegates to background worker

**UI Flow:**

1. On open: Request accounts from background worker
2. On account expand: Request statements for that account
3. On statement click: Request PDF download and trigger browser download
4. On refresh: Clear cache and reload accounts

### 3. Content Script (`extension/content.mjs`)

Content scripts run in the context of bank web pages and handle bank-specific API interactions:

**Responsibilities:**

- **Bank detection** - Identify bank from URL and load appropriate module
- **Session extraction** - Extract authentication tokens/cookies from page context
- **API calls** - Execute bank-specific API requests with page credentials
- **Data transformation** - Convert bank responses to standardized format

**Lifecycle:**

- Injected when bank page loads (matched by manifest)
- Persists for lifetime of the tab
- Responds to messages from background worker
- Has access to page cookies and authentication state

**Bank Module Loading:**

- Dynamic import based on hostname detection
- Each bank has isolated implementation (e.g., `chase.mjs`, `citi.mjs`)
- Modules export: `bankId`, `getSessionId()`, `getProfile()`, `getAccounts()`, `getStatements()`, `downloadStatement()`

## Key Design Decisions

### Why Background Service Worker?

- **Persistent state** - Popup is ephemeral and loses all state on close
- **Cache survival** - Data persists across popup open/close cycles
- **Single source of truth** - Centralized cache management
- **CORS workaround** - Can proxy fetch requests that content scripts cannot make

### Why Content Scripts?

- **Cookie access** - Need page context to access authentication cookies
- **Same-origin requests** - Bank APIs require requests from the bank's domain
- **DOM access** - Some banks embed data in page HTML that must be extracted

### Cache Strategy

- **Session storage** - Data clears on browser close, not persistent to disk
- **15-minute TTL** - Balance between freshness and performance
- **Hierarchical keys** - Separate cache per bank, session, and account
- **Force refresh** - User can manually invalidate cache

## Message Flow

### First Open (Cache Miss)

```
Popup opens
    │
    ├─► getAccounts() ──► Background Worker
    │                         │
    │                         ├─► Check cache (miss)
    │                         │
    │                         ├─► Query content script
    │                         │       │
    │                         │       └─► Bank API call
    │                         │
    │                         ├─► Cache result
    │                         │
    │                         └─► Return to popup
    │
    └─► Render accounts
```

### Subsequent Opens (Cache Hit)

```
Popup opens
    │
    ├─► getAccounts() ──► Background Worker
    │                         │
    │                         ├─► Check cache (hit)
    │                         │
    │                         └─► Return cached data immediately
    │
    └─► Render accounts (instant!)
```

### Force Refresh

```
User clicks refresh button
    │
    ├─► clearCache() ──► Background Worker ──► Clear all cache
    │
    └─► getAccounts(forceRefresh=true) ──► Background Worker
                                               │
                                               ├─► Skip cache check
                                               │
                                               ├─► Query content script
                                               │       │
                                               │       └─► Bank API call
                                               │
                                               ├─► Cache result
                                               │
                                               └─► Return to popup
```

## Cache Keys

Caching uses hierarchical keys to ensure data consistency:

- **Accounts**: `cached_getAccounts_{bankId}_{sessionId}`
- **Statements**: `cached_getStatements_{bankId}_{sessionId}_{accountId}`

This ensures:

- Different banks don't share cache
- Different sessions don't share cache (logout/login resets cache)
- Different accounts maintain separate statement caches

## Type System

The extension uses TypeScript type definitions for message passing:

- **`MessageDataMap`** - Maps action names to request/response types
- **`ContentMessage`** - Union of messages sent to content scripts
- **`BackgroundMessage`** - Union of messages sent to background worker
- **`BackgroundResponse`** - Union of responses from background worker
- **`RequestFetchMessage`** - CORS proxy request format

Type safety ensures message contracts are consistent across all components.

## Supported Banks

Each bank has an isolated module in `bank/` directory:

- American Express
- Bank of America
- BMO
- Chase
- Chime
- Citi
- Discover
- Disnat
- Fidelity
- First Tech FCU

Each module exports a standard interface for account and statement retrieval.

## Security Considerations

- **No credential storage** - Extension never stores passwords or sensitive auth data
- **Session-only cache** - Data clears when browser closes
- **Same-origin requests** - Content scripts make API calls from bank's domain
- **No external servers** - All processing happens locally in the browser
- **Manifest permissions** - Only requests access to specific bank domains

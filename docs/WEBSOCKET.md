# WebSocket Implementation

This document describes the real-time WebSocket integration used by the Forward Email desktop and mobile applications.

## Architecture Overview

```
┌──────────────────┐     wss://api.forwardemail.net/v1/ws     ┌──────────────────┐
│  WebSocket Client│ ◄──────────────────────────────────────── │  Forward Email   │
│  (browser)       │         msgpackr / JSON frames            │  API Server      │
└──────┬───────────┘                                           └──────────────────┘
       │
       ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ WebSocket Updater│────►│  Svelte Stores   │────►│  UI Components   │
│ (event router)   │     │  (reactive)      │     │  (auto-refresh)  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
       │
       ▼
┌──────────────────┐
│ Notification Mgr │
│ (cross-platform) │
└──────────────────┘
```

## Connection

The WebSocket client (`src/utils/websocket-client.js`) connects to:

```
wss://api.forwardemail.net/v1/ws?msgpackr=true
```

- **Authentication**: Basic Auth via URL userinfo (alias email + password)
- **Encoding**: msgpackr binary framing when available, JSON fallback
- **Keep-alive**: 30-second ping/pong interval
- **Reconnection**: Exponential backoff with jitter (1s initial, 60s max, 50 attempts hard cap)
- **Security**: Enforces `wss://` only; credentials never logged or exposed to handlers

## All 21 Server Events

### IMAP Events (8)

| Event              | Description                                 |
| ------------------ | ------------------------------------------- |
| `newMessage`       | A new message arrived in a mailbox          |
| `messagesMoved`    | Messages were moved between folders         |
| `messagesCopied`   | Messages were copied to another folder      |
| `flagsUpdated`     | Message flags changed (read, starred, etc.) |
| `messagesExpunged` | Messages were permanently deleted           |
| `mailboxCreated`   | A new mailbox/folder was created            |
| `mailboxDeleted`   | A mailbox/folder was deleted                |
| `mailboxRenamed`   | A mailbox/folder was renamed                |

### CalDAV Events (6)

| Event                  | Description                      |
| ---------------------- | -------------------------------- |
| `calendarCreated`      | A new calendar was created       |
| `calendarUpdated`      | Calendar properties were updated |
| `calendarDeleted`      | A calendar was deleted           |
| `calendarEventCreated` | A new calendar event was created |
| `calendarEventUpdated` | A calendar event was updated     |
| `calendarEventDeleted` | A calendar event was deleted     |

### CardDAV Events (6)

| Event                | Description                          |
| -------------------- | ------------------------------------ |
| `addressBookCreated` | A new address book was created       |
| `addressBookUpdated` | Address book properties were updated |
| `addressBookDeleted` | An address book was deleted          |
| `contactCreated`     | A new contact was created            |
| `contactUpdated`     | A contact was updated                |
| `contactDeleted`     | A contact was deleted                |

### App Events (1)

| Event        | Description                                            |
| ------------ | ------------------------------------------------------ |
| `newRelease` | A new app version is available (triggers auto-updater) |

## msgpackr Binary Encoding

When the `?msgpackr=true` query parameter is set, the server sends binary-encoded messages using [msgpackr](https://github.com/kriszyp/msgpackr). The client lazily loads the `msgpackr/unpack` browser bundle and falls back to JSON parsing if the library is unavailable.

## Event Routing

The **WebSocket Updater** (`src/utils/websocket-updater.js`) bridges WebSocket events to Svelte stores:

- `newMessage` / `messagesMoved` / `flagsUpdated` → Refresh mailbox message list
- `mailboxCreated` / `mailboxDeleted` / `mailboxRenamed` → Refresh folder sidebar
- `calendarEvent*` → Sync calendar data
- `contact*` / `addressBook*` → Sync contacts
- `newRelease` → Trigger auto-update check via `updater-bridge.js`

## Notification Integration

The **Notification Manager** (`src/utils/notification-manager.js`) dispatches platform-appropriate notifications:

- **Web**: `Notification` API with `navigator.setAppBadge()`
- **Tauri Desktop**: `@tauri-apps/plugin-notification`
- **Tauri Mobile**: `@tauri-apps/plugin-notification` (APNs/FCM via native bridge)

## Rate Limiting

Inbound messages are rate-limited to prevent flood attacks. If the server sends more messages than the configured threshold within a time window, excess messages are silently dropped and a warning is logged.

## Usage

```javascript
import { createWebSocketClient, WS_EVENTS } from '../utils/websocket-client.js';

const ws = createWebSocketClient({
  url: 'wss://api.forwardemail.net/v1/ws',
  username: aliasEmail,
  password: aliasPassword,
  msgpackr: true,
});

// Listen for specific events
ws.on(WS_EVENTS.NEW_MESSAGE, (event, payload) => {
  console.log('New message:', payload);
});

// Listen for all events
ws.on('*', (event, payload) => {
  console.log(`Event: ${event}`, payload);
});

// Connect
ws.connect();

// Disconnect
ws.disconnect();
```

# VectorSpeech Chat

A local-first, peer-to-peer cryptographic messaging GUI built on the VectorSpeech engine.

Messages are encrypted using one-time tokenisers trained on deterministically selected Wikipedia
pages. Neither the seed phrase nor the tokeniser models are ever transmitted — only opaque token
vectors travel over the network.

## Prerequisites

| Tool | Version |
|------|---------|
| [Bun](https://bun.sh) | ≥ 1.1 |
| Python | ≥ 3.9 |
| sentencepiece | `pip install sentencepiece` |
| requests | `pip install requests` |

## Setup

```bash
# 1. Clone / unzip project
cd vectorspeech-chat

# 2. Install JS dependencies
bun install

# 3. Create required output directories
mkdir -p output temp

# 4. Place the engine files in the project root
cp /path/to/vectorspeech_engine_fixed.py .
cp /path/to/vital_articles_demo.json .

# 5. Verify Python dependencies
python3 -c "import sentencepiece, requests; print('OK')"
```

## Running

### Development (hot-reload)

```bash
bun run dev
```

Starts:
- **API server** on `http://localhost:3000`
- **Vite dev server** on `http://localhost:5173` (open this in your browser)

### Production

```bash
bun run build       # build the React app into dist/
bun run start       # serve everything from port 3000
```

Open `http://localhost:3000` in your browser.

### Custom port

```bash
PORT=4000 bun run start
```

## Usage

### 1. Add a contact

In the sidebar click **Add contact** and enter:
- **Name**: friendly label
- **IP**: their LAN/WAN IP address
- **Port**: default `3000` (must match their `PORT` setting)

### 2. Set a shared key

Both parties must agree on a **seed phrase** via an out-of-band channel (phone call, in-person,
Signal, etc.). The phrase is **never sent over the network**.

Click the key indicator in the top-right of the chat header → type the seed phrase → Save.

### 3. Send a message

Type in the input box and press **Enter** (Shift+Enter for newlines). The status indicator shows:

| Status | Meaning |
|--------|---------|
| `queued` | waiting to start |
| `encoding…` | Python engine fetching Wikipedia + training tokeniser |
| `sending…` | transmitting token vector to peer |
| `✓✓ delivered` | peer confirmed receipt |
| `sent` | transmitted but no ack |
| `failed` | hover to see error |

### 4. Receive a message

Incoming token vectors are decoded automatically if a key is set. If no key is set they appear as
`🔒 Set a key to decode this message`.

### 5. Change key / re-decode old messages

If you or your contact change the agreed seed phrase:

1. Click the **key button** and enter the new phrase → **Save key**
2. Selection mode activates automatically — checkboxes appear on messages that have a stored vector
3. Tick the messages encoded with the new key
4. Click **Re-decode (N)** — the engine re-fetches + re-trains and decodes them

### 6. P2P endpoint

Your instance listens at `http://<your-ip>:<PORT>/api/p2p/receive`. Share this address with anyone
running VectorSpeech Chat so they can add you as a contact.

## File layout

```
vectorspeech-chat/
├── server/
│   ├── index.ts          ← Elysia HTTP/WS server
│   ├── db.ts             ← SQLite schema + queries
│   └── crypto.ts         ← Python subprocess wrapper
├── src/
│   ├── App.tsx           ← Root component + state
│   ├── types.ts          ← Shared TypeScript types
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── ChatWindow.tsx
│   │   ├── MessageBubble.tsx
│   │   └── KeyManager.tsx
│   ├── hooks/
│   │   └── useWebSocket.ts
│   └── styles/globals.css
├── vectorspeech_engine_fixed.py   ← Python engine (you provide)
├── vital_articles_demo.json       ← Wikipedia index (you provide)
├── vectorspeech.db                ← SQLite database (auto-created)
├── output/                        ← Engine output JSONs (auto-created)
└── temp/                          ← Tokeniser temp files (auto-created)
```

## Security notes

- The seed phrase exists only in memory and in the SQLite DB on each local machine.
- Token vectors are sent in plaintext over HTTP — use a VPN/Tailscale if communicating over the internet.
- The SQLite DB is unencrypted. Protect it with filesystem permissions.
- Iteration numbers are not secret; they are transmitted with the vector.

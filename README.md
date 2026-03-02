# RemoteLab

Access AI coding CLI tools (Claude Code, Cline, Codex, etc.) from any browser — phone, tablet, or computer — via HTTPS.

## What It Does

You have a Mac with AI coding tools installed. RemoteLab lets you use them from your phone while you're away from the computer, through a chat interface in the browser.

```
Phone/Browser ──HTTPS──→ Cloudflare Tunnel ──→ RemoteLab (Node.js on your Mac)
                                                     │
                                               Chat UI (primary)
                                                     │
                                               Spawns CLI tools
                                               (claude, cline, codex)
```

## Setup Guide (AI-Executable)

> This guide is written so that an AI assistant (e.g. Claude Code) can execute most steps automatically. Steps marked with **[HUMAN]** require manual action.

### Prerequisites

- **macOS** with **Homebrew** installed
- **Node.js 18+**
- At least one AI CLI tool installed (e.g. `claude`)

### Phase 1: Clone & Install (AI can do this)

```bash
git clone https://github.com/Ninglo/remotelab.git ~/code/remotelab
cd ~/code/remotelab
npm install
npm link

# Install system dependencies
brew install dtach ttyd cloudflared
```

### Phase 2: Cloudflare Authentication [HUMAN]

> **This step opens a browser and requires the human to log in to Cloudflare and select a domain.**

Prerequisite: The human needs a domain added to Cloudflare (free plan works). If they don't have one, they need to:
1. Buy a domain ($1-12/year from Namecheap, Porkbun, etc.)
2. Create a free Cloudflare account at https://dash.cloudflare.com
3. Add the domain to Cloudflare and update nameservers at the registrar

Once the domain is ready, run:

```bash
cloudflared tunnel login
```

This opens a browser. The human selects their domain, then tells you to continue.

### Phase 3: Create Tunnel & Configure (AI can do this)

After the human confirms Phase 2 is done:

```bash
# Create tunnel (use any name you like)
cloudflared tunnel create remotelab

# Note the Tunnel ID (UUID) from the output, then route DNS.
# Replace SUBDOMAIN.DOMAIN with the actual values:
cloudflared tunnel route dns remotelab SUBDOMAIN.DOMAIN
```

Create the cloudflared config (replace placeholders with real values):

```bash
cat > ~/.cloudflared/config.yml << EOF
tunnel: remotelab
credentials-file: /Users/$(whoami)/.cloudflared/<TUNNEL_ID>.json
protocol: http2

ingress:
  - hostname: SUBDOMAIN.DOMAIN
    service: http://127.0.0.1:7681
  - hostname: SUBDOMAIN2.DOMAIN
    service: http://127.0.0.1:7690
  - service: http_status:404
EOF
```

> Port 7681 = auth-proxy (terminal fallback). Port 7690 = chat server (primary interface). Use two subdomains if you want both accessible, or just map the chat server.

### Phase 4: Generate Credentials (AI can do this)

```bash
# Generate access token
remotelab generate-token

# (Optional) Set username & password for login
remotelab set-password
```

Save the token — it will be needed to log in.

### Phase 5: Create LaunchAgent Services (AI can do this)

Create three plist files. All paths must be absolute (use `which node`, `which cloudflared`, `whoami` to get real values).

**Chat server** (`~/Library/LaunchAgents/com.chatserver.claude.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.chatserver.claude</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-s</string>
        <string>NODE_ABSOLUTE_PATH</string>
        <string>REMOTELAB_DIR/chat-server.mjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>USER_HOME</string>
    <key>StandardOutPath</key>
    <string>USER_HOME/Library/Logs/chat-server.log</string>
    <key>StandardErrorPath</key>
    <string>USER_HOME/Library/Logs/chat-server.error.log</string>
</dict>
</plist>
```

**Auth proxy** (`~/Library/LaunchAgents/com.authproxy.claude.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.authproxy.claude</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-s</string>
        <string>NODE_ABSOLUTE_PATH</string>
        <string>REMOTELAB_DIR/auth-proxy.mjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>USER_HOME</string>
    <key>StandardOutPath</key>
    <string>USER_HOME/Library/Logs/auth-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>USER_HOME/Library/Logs/auth-proxy.error.log</string>
</dict>
</plist>
```

**Cloudflared** (`~/Library/LaunchAgents/com.cloudflared.tunnel.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflared.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>CLOUDFLARED_ABSOLUTE_PATH</string>
        <string>tunnel</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>USER_HOME</string>
    <key>StandardOutPath</key>
    <string>USER_HOME/Library/Logs/cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>USER_HOME/Library/Logs/cloudflared.error.log</string>
</dict>
</plist>
```

Replace all placeholders (`NODE_ABSOLUTE_PATH`, `REMOTELAB_DIR`, `USER_HOME`, `CLOUDFLARED_ABSOLUTE_PATH`) with actual absolute paths.

### Phase 6: Start & Verify (AI can do this)

```bash
remotelab start

# Or manually:
launchctl load ~/Library/LaunchAgents/com.chatserver.claude.plist
launchctl load ~/Library/LaunchAgents/com.authproxy.claude.plist
launchctl load ~/Library/LaunchAgents/com.cloudflared.tunnel.plist
```

Verify:

```bash
# All three should show PIDs
launchctl list | grep -E 'chatserver|authproxy|cloudflared'

# Chat server should say "listening on 127.0.0.1:7690"
tail -5 ~/Library/Logs/chat-server.log

# Auth proxy should say "listening on 127.0.0.1:7681"
tail -5 ~/Library/Logs/auth-proxy.log

# Should show "Registered tunnel connection"
tail -5 ~/Library/Logs/cloudflared.error.log
```

### Phase 7: Access [HUMAN]

Open in a browser:

```
https://SUBDOMAIN.DOMAIN/?token=YOUR_TOKEN
```

The token is exchanged for a session cookie on first visit. After that, just visit the URL without the token.

### Alternative: Interactive Setup

Instead of the manual phases above, you can run the interactive setup wizard which handles phases 1-6:

```bash
remotelab setup
```

It will prompt for domain, handle Cloudflare auth, create all config files, and start services.

## CLI Commands

```
remotelab setup                Run interactive setup wizard
remotelab start                Start all services (chat + proxy + tunnel)
remotelab stop                 Stop all services
remotelab restart [service]    Restart: chat | proxy | tunnel | all
remotelab chat                 Run chat server in foreground
remotelab server               Run auth proxy in foreground
remotelab generate-token       Generate a new access token
remotelab set-password         Set username & password for login
remotelab --help               Show help
```

## Architecture

Two services run on the Mac, both behind Cloudflare Tunnel:

| Service | Port | Role |
|---------|------|------|
| `chat-server.mjs` | 7690 | **Primary.** Chat UI, spawns CLI tools, WebSocket streaming |
| `auth-proxy.mjs` | 7681 | **Fallback.** Terminal-over-browser via ttyd, for emergencies |

The chat server provides a mobile-friendly conversation interface. The auth-proxy provides raw terminal access as a backup if the chat server breaks.

### How Chat Works

1. User opens chat UI in browser
2. Creates a session (picks a folder + tool)
3. Sends a message → WebSocket → server spawns CLI tool with the message
4. Tool output streams back as events (messages, tool use, reasoning, etc.)
5. Session persists across disconnects — history stored on disk

### Supported Tools

- **Claude Code** (`claude`) — primary, with `--dangerously-skip-permissions` and session resume
- **Cline** (`cline`)
- **Codex** (`codex`)
- Any custom CLI tool added from the dashboard

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_PORT` | `7690` | Chat server port |
| `LISTEN_PORT` | `7681` | Auth proxy port |
| `TTYD_PORT_RANGE_START` | `7700` | ttyd per-session port range start |
| `TTYD_PORT_RANGE_END` | `7799` | ttyd per-session port range end |
| `SESSION_EXPIRY` | `86400000` | Cookie lifetime in ms (default 24h) |
| `SECURE_COOKIES` | `1` | Set `0` for localhost without HTTPS |

## File Locations

| Path | Description |
|------|-------------|
| `~/.config/claude-web/auth.json` | Access token + password hash |
| `~/.config/claude-web/chat-sessions.json` | Chat session metadata |
| `~/.config/claude-web/chat-history/` | Per-session event logs (JSONL) |
| `~/.config/claude-web/sessions.json` | Terminal session metadata |
| `~/.config/claude-web/sockets/` | dtach socket files |
| `~/Library/Logs/chat-server.log` | Chat server stdout |
| `~/Library/Logs/auth-proxy.log` | Auth proxy stdout |
| `~/Library/Logs/cloudflared.log` | Tunnel logs |

## Security

- HTTPS via Cloudflare Tunnel (TLS at edge)
- 256-bit random access token with timing-safe comparison
- Scrypt-hashed passwords (optional, alternative to token)
- HttpOnly, Secure, SameSite=Strict session cookies (24h expiry)
- Per-IP rate limiting with exponential backoff on failed login
- Localhost-only binding (127.0.0.1) — no direct external access
- CSP headers with nonce-based script allowlist
- Input validation: folder paths must exist, tool commands reject shell metacharacters

## Troubleshooting

### Service won't start
```bash
tail -50 ~/Library/Logs/chat-server.error.log
tail -50 ~/Library/Logs/auth-proxy.error.log
```

### DNS not resolving
Wait 5-30 minutes after setup. Check: `dig SUBDOMAIN.DOMAIN +short`

### Port already in use
```bash
lsof -i :7690   # chat server
lsof -i :7681   # auth proxy
```

### Restart a single service
```bash
remotelab restart chat    # just the chat server
remotelab restart proxy   # just the auth proxy
remotelab restart tunnel  # just cloudflared
```

## License

MIT

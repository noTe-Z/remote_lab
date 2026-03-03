# RemoteLab Setup Guide (AI-Executable)

This document is written to be executed by an AI agent (Claude Code, etc.).

Steps marked **[HUMAN]** cannot be automated — they require the user to interact with a browser or confirm something. At each `[HUMAN]` step, stop, explain what the user needs to do, and wait for confirmation before continuing.

---

## What you're setting up

Three macOS LaunchAgent services that auto-start on boot:

| Service | Port | Role |
|---------|------|------|
| `com.chatserver.claude` | 7690 | Primary chat interface (this is what the user accesses) |
| `com.authproxy.claude` | 7681 | Terminal fallback (localhost only, emergency access) |
| `com.cloudflared.tunnel` | — | Cloudflare tunnel — routes a public HTTPS domain to port 7690 |

**Goal:** User opens `https://[subdomain].[domain]/?token=TOKEN` on their phone and gets a working chat UI.

---

## Pre-flight checklist

Before starting, verify the following. If anything is missing, install it or inform the user.

```bash
# macOS required
uname -s   # must be Darwin

# Homebrew
which brew || echo "MISSING: install Homebrew first"

# Node.js 18+
node --version

# At least one AI CLI tool
which claude || which codex || which cline || echo "MISSING: install at least one AI CLI tool"

# Check if remotelab is already installed via npm link
which remotelab 2>/dev/null && echo "already linked" || echo "need to npm link"
```

---

## Phase 1: Clone & install

> **AI can execute this automatically.**

```bash
# If not already cloned:
git clone https://github.com/Ninglo/remotelab.git ~/code/remotelab
cd ~/code/remotelab
npm install
npm link   # makes `remotelab` available globally

# Install system dependencies
brew install dtach ttyd cloudflared
```

Verify:
```bash
which remotelab
which dtach
which ttyd
which cloudflared
```

---

## Phase 2: Generate access token

> **AI can execute this automatically.**

```bash
remotelab generate-token
```

This writes to `~/.config/claude-web/auth.json` and prints the token. **Capture this token** — it's required for the first login.

Optionally, set a username/password alternative:
```bash
remotelab set-password
```

---

## Phase 3: [HUMAN] Cloudflare authentication

> **Stop here. The user must do this manually.**

Tell the user:

> "I need you to authenticate with Cloudflare. A browser will open — log in to your Cloudflare account and select the domain `[DOMAIN]` when prompted. Come back and tell me when it's done."

```bash
cloudflared tunnel login
```

Wait for the browser flow. Confirm success:
```bash
ls ~/.cloudflared/cert.pem && echo "authenticated" || echo "FAILED — cert.pem not found"
```

---

## Phase 4: Create tunnel & route DNS

> **AI can execute this automatically** (after Phase 3 is confirmed done).

```bash
# Create the tunnel (name can be anything)
cloudflared tunnel create remotelab
```

The output includes a Tunnel ID (UUID format). Capture it — you'll need it in the next command.

```bash
# Route DNS — replace SUBDOMAIN.DOMAIN with actual values
cloudflared tunnel route dns remotelab SUBDOMAIN.DOMAIN
```

Create the cloudflared config file. Replace `TUNNEL_ID`, `SUBDOMAIN`, and `DOMAIN` with actual values:

```bash
mkdir -p ~/.cloudflared

cat > ~/.cloudflared/config.yml << EOF
tunnel: remotelab
credentials-file: /Users/$(whoami)/.cloudflared/TUNNEL_ID.json
protocol: http2

ingress:
  - hostname: SUBDOMAIN.DOMAIN
    service: http://127.0.0.1:7690
  - service: http_status:404
EOF
```

> **Important:** The tunnel routes to port **7690** (chat server), not 7681. The auth-proxy is localhost-only.

Verify config is valid:
```bash
cloudflared tunnel validate
```

---

## Phase 5: Create LaunchAgent plists

> **AI can execute this automatically.** All paths must be absolute.

Get the actual paths first:
```bash
which node         # e.g. /opt/homebrew/bin/node or /usr/local/bin/node
echo $HOME         # e.g. /Users/yourname
REMOTELAB_DIR=$(cd ~/code/remotelab && pwd)   # absolute path to repo
```

### 5a. Chat server (primary service)

```bash
cat > ~/Library/LaunchAgents/com.chatserver.claude.plist << EOF
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
        <string>NODE_PATH_HERE</string>
        <string>REMOTELAB_DIR_HERE/chat-server.mjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>HOME_DIR_HERE</string>
    <key>StandardOutPath</key>
    <string>HOME_DIR_HERE/Library/Logs/chat-server.log</string>
    <key>StandardErrorPath</key>
    <string>HOME_DIR_HERE/Library/Logs/chat-server.error.log</string>
</dict>
</plist>
EOF
```

Replace `NODE_PATH_HERE`, `REMOTELAB_DIR_HERE`, `HOME_DIR_HERE` with actual absolute paths.

### 5b. Auth proxy (fallback service)

```bash
cat > ~/Library/LaunchAgents/com.authproxy.claude.plist << EOF
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
        <string>NODE_PATH_HERE</string>
        <string>REMOTELAB_DIR_HERE/auth-proxy.mjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>HOME_DIR_HERE</string>
    <key>StandardOutPath</key>
    <string>HOME_DIR_HERE/Library/Logs/auth-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>HOME_DIR_HERE/Library/Logs/auth-proxy.error.log</string>
</dict>
</plist>
EOF
```

### 5c. Cloudflare tunnel

```bash
CLOUDFLARED_PATH=$(which cloudflared)

cat > ~/Library/LaunchAgents/com.cloudflared.tunnel.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflared.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>$CLOUDFLARED_PATH</string>
        <string>tunnel</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>HOME_DIR_HERE</string>
    <key>StandardOutPath</key>
    <string>HOME_DIR_HERE/Library/Logs/cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>HOME_DIR_HERE/Library/Logs/cloudflared.error.log</string>
</dict>
</plist>
EOF
```

---

## Phase 6: Start & verify

> **AI can execute this automatically.**

```bash
mkdir -p ~/Library/Logs

# Load all three services
launchctl load ~/Library/LaunchAgents/com.chatserver.claude.plist
launchctl load ~/Library/LaunchAgents/com.authproxy.claude.plist
launchctl load ~/Library/LaunchAgents/com.cloudflared.tunnel.plist

sleep 3
```

Verify all three have real PIDs:
```bash
launchctl list | grep -E 'chatserver|authproxy|cloudflared'
# Column 1 should be a number (PID), not a dash.
# A dash means the service crashed — check the error log.
```

Verify chat server is listening:
```bash
tail -5 ~/Library/Logs/chat-server.log
# Should contain: "Chat server listening on http://127.0.0.1:7690"
```

Verify tunnel is connected:
```bash
tail -10 ~/Library/Logs/cloudflared.error.log
# Should contain: "Registered tunnel connection"
```

Check DNS propagation (may take 5–30 minutes):
```bash
dig @1.1.1.1 SUBDOMAIN.DOMAIN +short
# Should return one or more Cloudflare IPs
```

---

## Phase 7: [HUMAN] First login

> **Stop here. Tell the user their access URL.**

```
https://SUBDOMAIN.DOMAIN/?token=TOKEN_FROM_PHASE_2
```

Tell the user:

> "Setup is complete. Open this URL on your phone:
> `https://SUBDOMAIN.DOMAIN/?token=TOKEN`
>
> The token is a one-time URL param — after you log in, a session cookie is set and you won't need the token again.
>
> DNS propagation can take up to 30 minutes if the URL doesn't work immediately."

---

## Alternative: Interactive setup wizard

Instead of the manual phases above, you can run:

```bash
remotelab setup
```

This interactive script handles phases 1–6 automatically, prompting for domain info and pausing for the Cloudflare browser login.

---

## Troubleshooting

### Service shows dash (no PID) in launchctl list

The service crashed on startup. Check the error log:
```bash
tail -50 ~/Library/Logs/chat-server.error.log
tail -50 ~/Library/Logs/auth-proxy.error.log
```

Common causes:
- Node.js path wrong in plist (use absolute path from `which node`)
- Port already in use: `lsof -i :7690` or `lsof -i :7681`
- Missing `~/.config/claude-web/auth.json` — run `remotelab generate-token`

### Restart after config changes

```bash
remotelab restart chat     # restart just chat server
remotelab restart proxy    # restart just auth proxy
remotelab restart tunnel   # restart just cloudflared
remotelab restart all      # restart everything
```

### Token lost

Generate a new one:
```bash
remotelab generate-token
```

The old token is replaced. Use the new token to log in.

### DNS not propagating

```bash
dig @1.1.1.1 SUBDOMAIN.DOMAIN +short
```

If empty, wait up to 30 minutes. If it never resolves, check that the DNS route was created:
```bash
cloudflared tunnel route dns list
```

### Wipe and start over

```bash
remotelab stop
rm ~/Library/LaunchAgents/com.chatserver.claude.plist
rm ~/Library/LaunchAgents/com.authproxy.claude.plist
rm ~/Library/LaunchAgents/com.cloudflared.tunnel.plist
rm ~/.cloudflared/config.yml
# Then re-run from Phase 4 (or run: remotelab setup)
```

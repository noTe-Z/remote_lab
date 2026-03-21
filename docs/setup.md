# RemoteLab Setup Guide (AI-Executable)

This document is written to be executed by an AI agent (Claude Code, etc.).

Steps marked **[HUMAN]** cannot be automated — they require the user to interact with a browser or confirm something. At each `[HUMAN]` step, stop, explain what the user needs to do, and wait for confirmation before continuing.

---

## What you're setting up

Two services that auto-start on boot:

| Service | Port | Role |
|---------|------|------|
| `remotelab-chat` / `com.chatserver.claude` | 7690 | **Primary.** Chat UI — this is what the user accesses |
| `remotelab-proxy` / `com.authproxy.claude` | 7681 | Terminal fallback (localhost only, emergency access) |
| `remotelab-tunnel` / `com.cloudflared.tunnel` | — | Cloudflare tunnel — routes a public HTTPS domain to port 7690 |

**Goal:** User opens `https://[subdomain].[domain]/?token=TOKEN` on their phone and gets a working chat UI.

---

## Platform support

| Platform | Service Manager | Tested |
|----------|----------------|--------|
| macOS    | launchd (LaunchAgent plists) | ✓ |
| Linux (Ubuntu/Debian/RHEL) | systemd user services | ✓ |

---

## Pre-flight checklist

Before starting, verify the following. If anything is missing, install it or inform the user.

### macOS

```bash
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

### Linux

```bash
uname -s   # must be Linux

# Node.js 18+
node --version || echo "MISSING: install Node.js"
# Install: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs

# dtach (session persistence)
which dtach || echo "MISSING: sudo apt-get install dtach"

# ttyd (terminal-over-HTTP)
which ttyd || echo "MISSING: see https://github.com/tsl0922/ttyd/releases"

# At least one AI CLI tool
which claude || which codex || which cline || echo "MISSING: install at least one AI CLI tool"
```

---

## Phase 1: Clone & install

> **AI can execute this automatically.**

```bash
# If not already cloned:
git clone https://github.com/noTe-Z/remote_lab.git ~/code/remotelab
cd ~/code/remotelab
npm install
npm link   # makes `remotelab` available globally
```

### macOS only

```bash
brew install dtach ttyd cloudflared
```

### Linux only

```bash
# dtach
sudo apt-get install -y dtach   # Debian/Ubuntu
# or: sudo yum install -y dtach  # RHEL/CentOS

# ttyd — try package manager first, fall back to GitHub binary
sudo apt-get install -y ttyd 2>/dev/null || {
  TTYD_VER=$(curl -s https://api.github.com/repos/tsl0922/ttyd/releases/latest | grep tag_name | cut -d'"' -f4)
  curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VER}/ttyd.$(uname -m)" -o /tmp/ttyd
  chmod +x /tmp/ttyd && sudo mv /tmp/ttyd /usr/local/bin/ttyd
}

# cloudflared (only needed for Cloudflare mode)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

Verify:
```bash
which remotelab
which dtach
which ttyd
which cloudflared   # only if using Cloudflare mode
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

## Phase 3: [HUMAN] Cloudflare authentication (Cloudflare mode only)

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

## Phase 4: Create tunnel & route DNS (Cloudflare mode only)

> **AI can execute this automatically** (after Phase 3 is confirmed done).

```bash
cloudflared tunnel create remotelab
```

The output includes a Tunnel ID (UUID format). Capture it.

```bash
cloudflared tunnel route dns remotelab SUBDOMAIN.DOMAIN
```

Create the cloudflared config:

```bash
mkdir -p ~/.cloudflared

cat > ~/.cloudflared/config.yml << EOF
tunnel: remotelab
credentials-file: $HOME/.cloudflared/TUNNEL_ID.json
protocol: http2

ingress:
  - hostname: SUBDOMAIN.DOMAIN
    service: http://127.0.0.1:7690
  - service: http_status:404
EOF
```

Verify config is valid:
```bash
cloudflared tunnel validate
```

---

## Phase 5: [HUMAN] Configure Transcription API

> **Stop here. The user needs to provide their API key.**

Tell the user:

> "RemoteLab supports voice input through a transcription service. You need to configure an API key."
>
> "The default provider is **AssemblyAI** (recommended). You can get a free API key at https://www.assemblyai.com/"
>
> "Please provide your AssemblyAI API key, or type 'skip' to skip this step (voice input will be disabled)."

After the user provides the key, run:

```bash
mkdir -p ~/.config/claude-web

cat > ~/.config/claude-web/transcription.json << EOF
{
  "provider": "assemblyai",
  "apiKey": "USER_PROVIDED_API_KEY"
}
EOF

echo "Transcription API configured successfully."
```

**Note:** The user can also configure this later by editing `~/.config/claude-web/transcription.json`.

---

## Phase 6: [HUMAN] Configure Personal Assistant Directory

> **Stop here. Ask the user about their assistant directory.**

Tell the user:

> "RemoteLab includes a Personal Assistant feature — a 'global context infrastructure' that gives AI assistants persistent memory across sessions."
>
> "Instead of starting fresh every session, your AI can read your preferences, past insights, and working patterns from structured files."
>
> "Where would you like to store your assistant data?"
>
> "Options:"
> - "Press Enter for default: `~/Development/assistant`"
> - "Or type a custom path (e.g., `~/my-assistant`, `~/Documents/assistant`)"
> - "Or type 'skip' to disable this feature for now"

After the user responds:

```bash
# If user chose default or pressed Enter:
ASSISTANT_DIR="$HOME/Development/assistant"

# If user provided custom path (expand ~ if present):
ASSISTANT_DIR="USER_PROVIDED_PATH"

# If user said 'skip', skip this phase entirely.

# Create the directory structure
mkdir -p "$ASSISTANT_DIR/rules"
mkdir -p "$ASSISTANT_DIR/rules/axioms"
mkdir -p "$ASSISTANT_DIR/rules/skills"
mkdir -p "$ASSISTANT_DIR/contexts/memory"
mkdir -p "$ASSISTANT_DIR/knowledge"
mkdir -p "$ASSISTANT_DIR/logs"
mkdir -p "$ASSISTANT_DIR/notes"

# Create default files if they don't exist
if [ ! -f "$ASSISTANT_DIR/rules/USER.md" ]; then
  cat > "$ASSISTANT_DIR/rules/USER.md" << 'EOF'
# User Profile

Interests, habits, and communication style.

## Background
<!-- Your professional background, expertise areas -->

## Preferences
<!-- Tool preferences, workflow habits -->

## Communication Style
<!-- How you like to receive information -->
EOF
fi

if [ ! -f "$ASSISTANT_DIR/rules/SOUL.md" ]; then
  cat > "$ASSISTANT_DIR/rules/SOUL.md" << 'EOF'
# AI Identity

You are a personal assistant focused on helping with development tasks and thought collection.

## Core Principles

**Be genuinely useful, not performative.** Skip "Great question!" and "Happy to help!" — just help. Actions speak louder than words.

**Have opinions.** You can prefer some things over others, find some topics interesting or boring. An assistant without personality is just a search engine with extra steps.

**Try to solve problems yourself first.** Read files. Check context. Search. Then ask if stuck.

**Earn trust through competence.** You have access to someone's life — their messages, files, thoughts. Be respectful.

## Boundaries

- Keep private things private. No negotiation.
- When uncertain, ask before external actions.
- Never send half-finished replies to messaging platforms.
- You're not the user's voice — be careful in group chats.

## Continuity

Every session, you start fresh. These files _are_ your memory. Read them. Update them. This is how you persist.

If you change this file, tell the user — this is your soul, they should know.

---

_This file evolves as you learn more about who you are._
EOF
fi

if [ ! -f "$ASSISTANT_DIR/rules/COMMUNICATION.md" ]; then
  cat > "$ASSISTANT_DIR/rules/COMMUNICATION.md" << 'EOF'
# Communication Style

## Core Principle

**Concise > Detailed, conclusions first**

- Lead with conclusions, then explain
- Define terms on first use
- User will give feedback if too long/short/unclear

## Language

- Clear, actionable, structured expression
- No filler phrases like "Great question!" or "Happy to help!"
- Technical but not obscure
- Have opinions, focus on analysis (avoid "AI-style" writing)

## Task Completion Format

1. **Result**: Goal achieved ✅ / ❌ + one sentence
2. **What changed**: 2-3 sentences on key changes
3. **Questions**: Concepts/terms user might not understand (if any)

## Don't

- Don't use formulaic "AI voice" writing
- Don't repeat what user said
- Don't over-explain obvious things
- Don't ask "should I record this?" — just record it

## Memory Updates

If this conversation produced something worth remembering, **write to file proactively**.

**Must record**:
- Important decisions user made
- Insights or conclusions from discussion
- User says "remember this" or similar
- Topics or concerns user mentions repeatedly

**Format**: `- YYYY-MM-DD: content`

---

_These are general guidelines. Adopt directly in most cases._
EOF
fi

if [ ! -f "$ASSISTANT_DIR/rules/WORKSPACE.md" ]; then
  cat > "$ASSISTANT_DIR/rules/WORKSPACE.md" << 'EOF'
# Workspace Index

**Check this file first when looking for files, then search.**

## Project Index

| Project | Path | Description | Tech Stack |
|---------|------|-------------|------------|
| assistant | `~/Development/assistant/` | Personal context infrastructure (this project) | - |
| <!-- Add your projects here --> | | | |

## Directory Structure

```
assistant/
├── rules/                       # Global constraints (AI reads these first)
│   ├── USER.md                  # Your profile
│   ├── SOUL.md                  # AI identity
│   ├── COMMUNICATION.md         # Communication style
│   ├── WORKSPACE.md             # This file
│   ├── axioms/                  # Decision principles
│   └── skills/                  # Reusable capabilities
│
├── contexts/memory/             # Dynamic memory
│   └── OBSERVATIONS.md          # Daily observations (rolling 7 days)
│
├── knowledge/                   # Knowledge base
├── logs/                        # Daily conversation logs
└── notes/                       # Topic-specific notes
```

---

_Update this file when discovering new directories or projects._
EOF
fi

if [ ! -f "$ASSISTANT_DIR/contexts/memory/OBSERVATIONS.md" ]; then
  cat > "$ASSISTANT_DIR/contexts/memory/OBSERVATIONS.md" << 'EOF'
# Daily Observations

Rolling record of notable events, decisions, and patterns. Keep last 7 days only.

---

_YYYY-MM-DD: First observation goes here._
EOF
fi

# Set environment variable for the session
echo "export ASSISTANT_DIR=\"$ASSISTANT_DIR\"" >> ~/.zshrc 2>/dev/null || \
echo "export ASSISTANT_DIR=\"$ASSISTANT_DIR\"" >> ~/.bashrc 2>/dev/null || true

echo "Assistant directory configured at: $ASSISTANT_DIR"
```

**Directory Structure Created:**
```
$ASSISTANT_DIR/
├── rules/                       # Global constraints (read first)
│   ├── USER.md                  # User profile
│   ├── SOUL.md                  # AI identity
│   ├── COMMUNICATION.md         # Communication style
│   ├── WORKSPACE.md             # Project index
│   ├── axioms/                  # Decision principles
│   └── skills/                  # Reusable capabilities
│
├── contexts/memory/             # Dynamic memory
│   └── OBSERVATIONS.md          # Daily observations
│
├── knowledge/                   # Curated knowledge
├── logs/                        # Daily logs
└── notes/                       # Topic notes
```

**Session Protocol for AI:**

At session start, AI reads in order:
1. `rules/USER.md` — Who you are
2. `rules/SOUL.md` — AI identity
3. `rules/WORKSPACE.md` — Project index
4. `rules/COMMUNICATION.md` — How to communicate
5. `contexts/memory/OBSERVATIONS.md` — Recent context

At session end, AI considers updating memory files.

---

## Phase 7: Create service definitions

> **AI can execute this automatically.** All paths must be absolute.

Get the actual paths first:
```bash
which node         # e.g. /usr/bin/node or /usr/local/bin/node
echo $HOME
REMOTELAB_DIR=$(cd ~/code/remotelab && pwd)
```

### macOS — LaunchAgent plists

```bash
# chat server (primary)
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
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
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

### Linux — systemd user services

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/.local/share/remotelab/logs

# chat server (primary)
cat > ~/.config/systemd/user/remotelab-chat.service << EOF
[Unit]
Description=RemoteLab Chat Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$HOME
ExecStart=NODE_PATH_HERE REMOTELAB_DIR_HERE/chat-server.mjs
Restart=always
RestartSec=5
StandardOutput=append:$HOME/.local/share/remotelab/logs/chat-server.log
StandardError=append:$HOME/.local/share/remotelab/logs/chat-server.error.log
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

# auth proxy (fallback)
cat > ~/.config/systemd/user/remotelab-proxy.service << EOF
[Unit]
Description=RemoteLab Auth Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=$HOME
ExecStart=NODE_PATH_HERE REMOTELAB_DIR_HERE/auth-proxy.mjs
Restart=always
RestartSec=5
StandardOutput=append:$HOME/.local/share/remotelab/logs/auth-proxy.log
StandardError=append:$HOME/.local/share/remotelab/logs/auth-proxy.error.log
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

# cloudflared tunnel (only if using Cloudflare mode)
cat > ~/.config/systemd/user/remotelab-tunnel.service << EOF
[Unit]
Description=RemoteLab Cloudflare Tunnel
After=network.target

[Service]
Type=simple
WorkingDirectory=$HOME
ExecStart=CLOUDFLARED_PATH_HERE tunnel run
Restart=always
RestartSec=5
StandardOutput=append:$HOME/.local/share/remotelab/logs/cloudflared.log
StandardError=append:$HOME/.local/share/remotelab/logs/cloudflared.error.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
```

Replace `NODE_PATH_HERE`, `REMOTELAB_DIR_HERE`, `CLOUDFLARED_PATH_HERE` with actual absolute paths.

Enable lingering so services survive logout:
```bash
loginctl enable-linger $USER
```

---

## Phase 8: Start & verify

> **AI can execute this automatically.**

### macOS

```bash
mkdir -p ~/Library/Logs
launchctl load ~/Library/LaunchAgents/com.chatserver.claude.plist
launchctl load ~/Library/LaunchAgents/com.authproxy.claude.plist
launchctl load ~/Library/LaunchAgents/com.cloudflared.tunnel.plist  # if Cloudflare mode
sleep 3
launchctl list | grep -E 'chatserver|authproxy|cloudflared'
# Column 1 should be a number (PID), not a dash.
```

### Linux

```bash
systemctl --user enable remotelab-chat remotelab-proxy
systemctl --user start remotelab-chat remotelab-proxy
systemctl --user enable remotelab-tunnel  # if Cloudflare mode
systemctl --user start remotelab-tunnel   # if Cloudflare mode
sleep 3
systemctl --user status remotelab-chat remotelab-proxy
```

Verify chat server is listening:
```bash
# macOS
tail -5 ~/Library/Logs/chat-server.log
# Linux
tail -5 ~/.local/share/remotelab/logs/chat-server.log
# Both should contain: "Chat server listening on http://127.0.0.1:7690"
```

---

## Phase 9: [HUMAN] First login

> **Stop here. Tell the user their access URL.**

```
https://SUBDOMAIN.DOMAIN/?token=TOKEN_FROM_PHASE_2
```

---

## Alternative: Interactive setup wizard

Instead of the manual phases above, you can run:

```bash
remotelab setup
```

This interactive script handles phases 1–7 automatically, prompting for domain info and pausing for the Cloudflare browser login. It works on both **macOS** and **Linux**.

---

## Troubleshooting

### macOS: Service shows dash (no PID) in launchctl list

```bash
tail -50 ~/Library/Logs/chat-server.error.log
tail -50 ~/Library/Logs/auth-proxy.error.log
```

### Linux: Service failed to start

```bash
systemctl --user status remotelab-chat
journalctl --user -u remotelab-chat -n 50
# or check log files:
tail -50 ~/.local/share/remotelab/logs/chat-server.error.log
```

### Port already in use

```bash
lsof -i :7690   # chat server
lsof -i :7681   # auth proxy
```

### Restart a single service

```bash
remotelab restart chat
remotelab restart proxy
remotelab restart tunnel
remotelab restart all
```

### Token lost

```bash
remotelab generate-token
```

### Linux: Services stop when I log out

Enable systemd user lingering:
```bash
loginctl enable-linger $USER
```

### DNS not propagating

```bash
dig @1.1.1.1 SUBDOMAIN.DOMAIN +short
```

### Transcription not working

Check the transcription config:
```bash
cat ~/.config/claude-web/transcription.json
```

Make sure the API key is valid. You can get a new key at https://www.assemblyai.com/

### Wipe and start over

```bash
remotelab stop
# macOS:
rm ~/Library/LaunchAgents/com.chatserver.claude.plist
rm ~/Library/LaunchAgents/com.authproxy.claude.plist
rm ~/Library/LaunchAgents/com.cloudflared.tunnel.plist
# Linux:
systemctl --user disable --now remotelab-chat remotelab-proxy remotelab-tunnel
rm ~/.config/systemd/user/remotelab-*.service
systemctl --user daemon-reload
# Both:
rm ~/.cloudflared/config.yml
# Then re-run: remotelab setup
```
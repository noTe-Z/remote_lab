#!/bin/bash
echo "Starting Claude Code web services..."
# Unload legacy shared ttyd plist if present (ttyd is now managed per-session by auth-proxy)
if launchctl list | grep -q 'com.ttyd.claude'; then
  launchctl unload ~/Library/LaunchAgents/com.ttyd.claude.plist 2>/dev/null || true
  echo "Unloaded legacy shared ttyd service"
fi
launchctl load ~/Library/LaunchAgents/com.authproxy.claude.plist 2>/dev/null || echo "auth-proxy already loaded"
if [ -f ~/Library/LaunchAgents/com.chatserver.claude.plist ]; then
  launchctl load ~/Library/LaunchAgents/com.chatserver.claude.plist 2>/dev/null || echo "chat-server already loaded"
fi
if [ -f ~/Library/LaunchAgents/com.cloudflared.tunnel.plist ]; then
  launchctl load ~/Library/LaunchAgents/com.cloudflared.tunnel.plist 2>/dev/null || echo "cloudflared already loaded"
fi

# Wait for chat-server to be ready
echo ""
echo "Waiting for chat-server to be ready..."
for i in {1..30}; do
  if curl -s http://127.0.0.1:7690/health > /dev/null 2>&1; then
    echo "✓ chat-server is ready!"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "⚠ chat-server not responding after 30 seconds"
  fi
  sleep 1
done

echo ""
echo "Services started!"
echo ""
echo "Check status with:"
echo "  launchctl list | grep -E 'authproxy|chatserver|cloudflared'"
echo ""
echo "View logs:"
echo "  tail -f ~/Library/Logs/auth-proxy.log"
echo "  tail -f ~/Library/Logs/chat-server.log"
if [ -f ~/Library/LaunchAgents/com.cloudflared.tunnel.plist ]; then
  echo "  tail -f ~/Library/Logs/cloudflared.log"
fi

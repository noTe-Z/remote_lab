import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Read assistantDir from environment variable (set via setup.md Phase 6)
function getAssistantDir() {
  const envDir = process.env.ASSISTANT_DIR;
  if (envDir) {
    return envDir.startsWith('~')
      ? join(homedir(), envDir.slice(1))
      : envDir;
  }
  // Default fallback
  return join(homedir(), 'Development', 'assistant');
}

const ASSISTANT_DIR = getAssistantDir();
const PENDING_FILE = join(ASSISTANT_DIR, 'contexts', 'memory', 'PENDING_SESSIONS.md');

/**
 * Load pending sessions from the markdown file.
 * Returns array of { id, name, folder, markedAt }.
 */
function loadPendingSessions() {
  try {
    if (!existsSync(PENDING_FILE)) return [];
    const content = readFileSync(PENDING_FILE, 'utf8');

    // Parse markdown to extract session entries
    const sessions = [];
    const lines = content.split('\n');
    let currentSession = null;

    for (const line of lines) {
      // Match: ## Session Name
      if (line.startsWith('## ')) {
        if (currentSession) sessions.push(currentSession);
        currentSession = { name: line.slice(3).trim(), id: null, folder: null, markedAt: null };
      }
      // Match: > ID: `xxx` | Folder: `xxx` | Marked: YYYY-MM-DD
      else if (line.startsWith('> ID:') && currentSession) {
        const idMatch = line.match(/ID: `([^`]+)`/);
        const folderMatch = line.match(/Folder: `([^`]+)`/);
        const markedMatch = line.match(/Marked: ([^\|]+)/);

        if (idMatch) currentSession.id = idMatch[1];
        if (folderMatch) currentSession.folder = folderMatch[1];
        if (markedMatch) currentSession.markedAt = markedMatch[1].trim();
      }
    }
    if (currentSession && currentSession.id) sessions.push(currentSession);

    return sessions;
  } catch {
    return [];
  }
}

/**
 * Save pending sessions to markdown file.
 */
function savePendingSessions(sessions) {
  const dir = dirname(PENDING_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (sessions.length === 0) {
    const emptyContent = `# Pending Sessions

> 标记为"待深入"的对话。点击 header 的大头钉图标可标记/取消标记。

（暂无待深入的内容）

---

**使用说明**：
- 在对话中点击右上角的大头钉图标可标记该 session 为待深入
- 点击左侧菜单中的 session 可继续该对话
- 完成后再次点击大头钉取消标记
`;
    writeFileSync(PENDING_FILE, emptyContent, 'utf8');
    return;
  }

  const lines = [
    `# Pending Sessions`,
    ``,
    `> 标记为"待深入"的对话。点击 header 的大头钉图标可标记/取消标记。`,
    ``,
  ];

  // Sort by markedAt, newest first
  const sorted = [...sessions].sort((a, b) =>
    (b.markedAt || '').localeCompare(a.markedAt || '')
  );

  for (const s of sorted) {
    const dateStr = s.markedAt || new Date().toISOString().slice(0, 10);
    lines.push(`## ${s.name || 'Unnamed Session'}`);
    lines.push(``);
    lines.push(`> ID: \`${s.id}\` | Folder: \`${s.folder || '?'}\` | Marked: ${dateStr}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`**操作方法**：点击左侧菜单中的 session 继续对话，完成后再次点击大头钉取消标记。`);

  writeFileSync(PENDING_FILE, lines.join('\n'), 'utf8');
}

/**
 * Add a session to pending list.
 * @param {object} session - { id, name, folder }
 */
export function addPendingSession(session) {
  const sessions = loadPendingSessions();

  // Check if already exists
  if (sessions.some(s => s.id === session.id)) return;

  sessions.push({
    id: session.id,
    name: session.name || session.folder?.split('/').pop() || 'Unnamed',
    folder: session.folder,
    markedAt: new Date().toISOString().slice(0, 10),
  });

  savePendingSessions(sessions);
}

/**
 * Remove a session from pending list.
 * @param {string} sessionId
 */
export function removePendingSession(sessionId) {
  const sessions = loadPendingSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  savePendingSessions(filtered);
}

/**
 * Check if a session is in pending list.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isPendingSession(sessionId) {
  const sessions = loadPendingSessions();
  return sessions.some(s => s.id === sessionId);
}

/**
 * Get all pending sessions.
 * @returns {Array}
 */
export function getPendingSessions() {
  return loadPendingSessions();
}

/**
 * Update session name in pending list (when session is renamed).
 * @param {string} sessionId
 * @param {string} newName
 */
export function updatePendingSessionName(sessionId, newName) {
  const sessions = loadPendingSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    session.name = newName;
    savePendingSessions(sessions);
  }
}

/**
 * Sync pending sessions file with actual session metadata.
 * This is called when the file needs to be regenerated from scratch.
 * @param {Array} sessionsWithFlag - Array of sessions with pendingFollowUp: true
 */
export function syncPendingSessions(sessionsWithFlag) {
  const pending = sessionsWithFlag
    .filter(s => s.pendingFollowUp)
    .map(s => ({
      id: s.id,
      name: s.name || s.folder?.split('/').pop() || 'Unnamed',
      folder: s.folder,
      markedAt: s.updatedAt || new Date().toISOString().slice(0, 10),
    }));
  savePendingSessions(pending);
}
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const INBOX_FILE = join(homedir(), '.config', 'claude-web', 'inbox.json');

/**
 * Load inbox items from disk.
 * Returns array of items sorted by created (newest first).
 */
function loadInbox() {
  try {
    if (!existsSync(INBOX_FILE)) return [];
    return JSON.parse(readFileSync(INBOX_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Save inbox items to disk.
 */
function saveInbox(items) {
  const dir = dirname(INBOX_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(INBOX_FILE, JSON.stringify(items, null, 2), 'utf8');
}

/**
 * Generate a short ID for inbox items.
 */
function generateId() {
  return randomBytes(8).toString('hex');
}

/**
 * Get all inbox items.
 * Items are persisted until manually deleted.
 * @returns {Array} All items, sorted newest first
 */
export function getTodayInbox() {
  const items = loadInbox();
  return items.sort((a, b) => new Date(b.created) - new Date(a.created));
}

/**
 * Add a new inbox item.
 * @param {string} content - The user's original text
 * @param {string} title - Optional title (defaults to first line of content)
 * @param {object} options - Optional metadata
 * @param {string} options.type - Item type: 'user', 'observer', 'reflector'
 * @param {object} options.metadata - Additional metadata for AI-initiated items
 * @returns {object} The created item
 */
export function addInboxItem(content, title = null, options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const items = loadInbox();

  // Generate title from first line if not provided
  const itemTitle = title || content.split('\n')[0].slice(0, 50) || 'Untitled';

  const item = {
    id: generateId(),
    title: itemTitle,
    content,
    created: new Date().toISOString(),
    date: today,
    type: options.type || 'user',
  };

  // Add metadata for AI-initiated items
  if (options.metadata) {
    item.metadata = options.metadata;
  }

  items.push(item);
  saveInbox(items);
  return item;
}

/**
 * Delete an inbox item by ID.
 * @param {string} id - The item ID
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteInboxItem(id) {
  const items = loadInbox();
  const idx = items.findIndex(item => item.id === id);
  if (idx === -1) return false;
  items.splice(idx, 1);
  saveInbox(items);
  return true;
}

/**
 * Get an inbox item by ID.
 * @param {string} id - The item ID
 * @returns {object|null} The item or null if not found
 */
export function getInboxItem(id) {
  const items = loadInbox();
  return items.find(item => item.id === id) || null;
}

/**
 * Update an inbox item by ID.
 * @param {string} id - The item ID
 * @param {object} updates - Fields to update (content, title)
 * @returns {object|null} The updated item or null if not found
 */
export function updateInboxItem(id, updates) {
  const items = loadInbox();
  const idx = items.findIndex(item => item.id === id);
  if (idx === -1) return null;

  // Update allowed fields
  if (updates.content !== undefined) {
    items[idx].content = updates.content;
    // Auto-update title from first line if not explicitly provided
    if (updates.title === undefined) {
      items[idx].title = updates.content.split('\n')[0].slice(0, 50) || 'Untitled';
    }
  }
  if (updates.title !== undefined) {
    items[idx].title = updates.title;
  }
  items[idx].updated = new Date().toISOString();

  saveInbox(items);
  return items[idx];
}

/**
 * Get list of unique folders from existing sessions.
 * This is used to populate the folder selection for creating a new session.
 * @returns {Array<string>} Array of folder paths
 */
export function getRecentFolders() {
  // Import session manager to get folders
  // We'll call this from router instead to avoid circular deps
  return [];
}

/**
 * Export inbox items as markdown format.
 * @returns {string} Markdown content
 */
export function exportInboxAsMarkdown() {
  const items = loadInbox();
  if (items.length === 0) {
    return `# Inbox

> 记录的想法和待办事项。AI 可以在对话中识别相关内容并建议融入讨论。

（暂无内容）

---

**使用说明**：
- 这里是你的想法碎片库
- 如果 AI 发现当前对话与某个 inbox 项相关，会建议是否一起讨论
- 确认融入后，该 inbox 项会被删除
`;
  }

  const lines = [
    `# Inbox`,
    ``,
    `> 记录的想法和待办事项。AI 可以在对话中识别相关内容并建议融入讨论。`,
    ``,
  ];

  // Group by date (newest first)
  const sortedItems = [...items].sort((a, b) => new Date(b.created) - new Date(a.created));

  for (const item of sortedItems) {
    const timeStr = new Date(item.created).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const typeLabel = item.type && item.type !== 'user' ? ` [${item.type}]` : '';

    lines.push(`## ${item.title}${typeLabel}`);
    lines.push(``);
    lines.push(`> 创建于 ${timeStr} | ID: \`${item.id}\``);
    lines.push(``);
    lines.push(item.content);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`**融入方法**：告诉 AI "融入 ID 为 xxx 的 inbox 项"，该 item 会被删除并合并到当前对话。`);

  return lines.join('\n');
}

/**
 * Sync inbox to a markdown file.
 * @param {string} targetPath - Target file path
 * @returns {boolean} True if successful
 */
export function syncInboxToFile(targetPath) {
  try {
    const content = exportInboxAsMarkdown();
    const dir = dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to sync inbox to file:', err);
    return false;
  }
}
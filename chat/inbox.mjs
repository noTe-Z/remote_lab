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
 * Get list of unique folders from existing sessions.
 * This is used to populate the folder selection for creating a new session.
 * @returns {Array<string>} Array of folder paths
 */
export function getRecentFolders() {
  // Import session manager to get folders
  // We'll call this from router instead to avoid circular deps
  return [];
}
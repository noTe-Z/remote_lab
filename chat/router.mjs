import { existsSync, statSync, readdirSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, dirname, basename, extname } from 'path';
import { parse as parseUrl, fileURLToPath } from 'url';
import { SESSION_EXPIRY, CHAT_IMAGES_DIR, CHAT_HISTORY_DIR } from '../lib/config.mjs';
import {
  sessions, saveAuthSessions,
  verifyToken, verifyPassword, generateToken,
  parseCookies, setCookie, clearCookie,
} from '../lib/auth.mjs';
import { getAvailableTools } from '../lib/tools.mjs';
import { listSessions, getSession, createSession, deleteSession, markMemoryStatus } from './session-manager.mjs';
import { getSidebarState } from './summarizer.mjs';
import { getPublicKey, addSubscription } from './push.mjs';
import { readBody } from '../lib/utils.mjs';
import { getAvailableSkills } from './skills.mjs';
import { getTodayInbox, addInboxItem, deleteInboxItem, getInboxItem } from './inbox.mjs';
import { transcribe } from '../lib/transcription.mjs';
import {
  getClientIp, isRateLimited, recordFailedAttempt, clearFailedAttempts,
  setSecurityHeaders, generateNonce, requireAuth,
} from './middleware.mjs';

// Paths (files are read from disk on each request for hot-reload)
const __dirname = dirname(fileURLToPath(import.meta.url));
const chatTemplatePath = join(__dirname, '..', 'templates', 'chat.html');
const loginTemplatePath = join(__dirname, '..', 'templates', 'login.html');
const staticDir = join(__dirname, '..', 'static');
const ASSISTANT_DIR = join(homedir(), 'Development', 'assistant');

const staticMimeTypes = {
  'manifest.json': 'application/manifest+json',
  'icon.svg': 'image/svg+xml',
  'apple-touch-icon.png': 'image/png',
  'chat.js': 'application/javascript',
  'marked.min.js': 'application/javascript',
  'sw.js': 'application/javascript',
};

export async function handleRequest(req, res) {
  const parsedUrl = parseUrl(req.url, true);
  const pathname = parsedUrl.pathname;

  // Static assets (read from disk each time for hot-reload)
  const staticName = pathname.slice(1); // strip leading /
  if (staticMimeTypes[staticName]) {
    try {
      const content = readFileSync(join(staticDir, staticName));
      res.writeHead(200, { 'Content-Type': staticMimeTypes[staticName], 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
    return;
  }

  const nonce = generateNonce();
  setSecurityHeaders(res, nonce);

  // Token auth via query
  const queryToken = parsedUrl.query.token;
  if (queryToken) {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
      res.end('Too many failed attempts. Please try again later.');
      return;
    }
    if (verifyToken(queryToken)) {
      clearFailedAttempts(ip);
      const sessionToken = generateToken();
      sessions.set(sessionToken, { expiry: Date.now() + SESSION_EXPIRY });
      saveAuthSessions();
      res.writeHead(302, { 'Location': '/', 'Set-Cookie': setCookie(sessionToken) });
      res.end();
    } else {
      recordFailedAttempt(ip);
      res.writeHead(302, { 'Location': '/login' });
      res.end();
    }
    return;
  }

  // Login — POST (form submit)
  if (pathname === '/login' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
      res.end('Too many failed attempts. Please try again later.');
      return;
    }
    let body;
    try { body = await readBody(req, 4096); } catch { body = ''; }
    const params = new URLSearchParams(body);
    const type = params.get('type');
    let valid = false;
    if (type === 'token') {
      valid = verifyToken(params.get('token') || '');
    } else if (type === 'password') {
      valid = verifyPassword(params.get('username') || '', params.get('password') || '');
    }
    if (valid) {
      clearFailedAttempts(ip);
      const sessionToken = generateToken();
      sessions.set(sessionToken, { expiry: Date.now() + SESSION_EXPIRY });
      saveAuthSessions();
      res.writeHead(302, { 'Location': '/', 'Set-Cookie': setCookie(sessionToken) });
    } else {
      recordFailedAttempt(ip);
      const mode = type === 'password' ? 'pw' : 'token';
      res.writeHead(302, { 'Location': `/login?error=1&mode=${mode}` });
    }
    res.end();
    return;
  }

  // Login — GET (show form)
  if (pathname === '/login') {
    const hasError = parsedUrl.query.error === '1';
    const mode = parsedUrl.query.mode === 'pw' ? 'pw' : 'token';
    let loginHtml;
    try { loginHtml = readFileSync(loginTemplatePath, 'utf8'); } catch { loginHtml = '<h1>Login template missing</h1>'; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(loginHtml
      .replace(/\{\{NONCE\}\}/g, nonce)
      .replace(/\{\{ERROR_CLASS\}\}/g, hasError ? '' : 'hidden')
      .replace(/\{\{MODE\}\}/g, mode));
    return;
  }

  // Logout
  if (pathname === '/logout') {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.session_token;
    if (token) { sessions.delete(token); saveAuthSessions(); }
    res.writeHead(302, { 'Location': '/login', 'Set-Cookie': clearCookie() });
    res.end();
    return;
  }

  // Auth required from here on
  if (!requireAuth(req, res)) return;

  // ---- API endpoints ----

  if (pathname === '/api/sessions' && req.method === 'GET') {
    const sessionList = listSessions();
    const folderFilter = parsedUrl.query.folder;
    const filtered = folderFilter
      ? sessionList.filter(s => s.folder === folderFilter)
      : sessionList;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: filtered }));
    return;
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 10240); } catch (err) {
      if (err.code === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      throw err;
    }
    try {
      const { folder, tool } = JSON.parse(body);
      if (!folder || !tool) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'folder and tool are required' }));
        return;
      }
      const resolvedFolder = folder.startsWith('~')
        ? join(homedir(), folder.slice(1))
        : resolve(folder);
      if (!existsSync(resolvedFolder) || !statSync(resolvedFolder).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Folder does not exist' }));
        return;
      }
      const session = createSession(resolvedFolder, tool);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ session }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
    return;
  }

  if (pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const ok = deleteSession(id);
    if (ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // PATCH /api/sessions/:id/memory-status - mark session memory status
  if (pathname.match(/^\/api\/sessions\/[^/]+\/memory-status$/) && req.method === 'POST') {
    const id = pathname.split('/')[3];
    let body;
    try { body = await readBody(req, 1024); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
      return;
    }
    try {
      const { saved, ignored } = JSON.parse(body);
      // Both saved and ignored set pendingMemory to false
      const pendingMemory = !(saved || ignored);
      const updated = markMemoryStatus(id, pendingMemory);
      if (updated) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, session: updated }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
    return;
  }

  if (pathname === '/api/tools' && req.method === 'GET') {
    const tools = getAvailableTools();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools }));
    return;
  }

  if (pathname === '/api/skills' && req.method === 'GET') {
    const skills = getAvailableSkills();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills }));
    return;
  }

  if (pathname === '/api/sidebar' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSidebarState()));
    return;
  }

  // GET /api/config - return client-side config
  if (pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      assistantDir: process.env.ASSISTANT_DIR || null
    }));
    return;
  }

  if (pathname === '/api/autocomplete' && req.method === 'GET') {
    const query = parsedUrl.query.q || '';
    const suggestions = [];
    try {
      const resolvedQuery = query.startsWith('~') ? join(homedir(), query.slice(1)) : query;
      const parentDir = dirname(resolvedQuery);
      const prefix = basename(resolvedQuery);
      if (existsSync(parentDir) && statSync(parentDir).isDirectory()) {
        for (const entry of readdirSync(parentDir)) {
          if (!prefix.startsWith('.') && entry.startsWith('.')) continue;
          const fullPath = join(parentDir, entry);
          if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
            if (entry.toLowerCase().startsWith(prefix.toLowerCase())) {
              suggestions.push(fullPath);
            }
          }
        }
      }
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ suggestions: suggestions.slice(0, 20) }));
    return;
  }

  if (pathname === '/api/browse' && req.method === 'GET') {
    const pathQuery = parsedUrl.query.path || '~';
    try {
      const resolvedPath = pathQuery === '~' || pathQuery === ''
        ? homedir()
        : pathQuery.startsWith('~')
          ? join(homedir(), pathQuery.slice(1))
          : resolve(pathQuery);
      const children = [];
      let parent = null;
      if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
        const parentPath = dirname(resolvedPath);
        parent = parentPath !== resolvedPath ? parentPath : null;
        for (const entry of readdirSync(resolvedPath)) {
          if (entry.startsWith('.')) continue;
          const fullPath = join(resolvedPath, entry);
          try {
            if (statSync(fullPath).isDirectory()) children.push({ name: entry, path: fullPath });
          } catch {}
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: resolvedPath, parent, children }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to browse directory' }));
    }
    return;
  }

  // Serve uploaded images
  if (pathname.startsWith('/api/images/') && req.method === 'GET') {
    const filename = pathname.slice('/api/images/'.length);
    // Sanitize: only allow alphanumeric, dash, underscore, dot
    if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const filepath = join(CHAT_IMAGES_DIR, filename);
    if (!existsSync(filepath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = filename.split('.').pop();
    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(readFileSync(filepath));
    return;
  }

  // POST /api/transcribe - transcribe audio file
  if (pathname === '/api/transcribe' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);

    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid content type' }));
      return;
    }

    const boundary = boundaryMatch[1];
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const audioBuffer = extractMultipartFile(buffer, boundary);

      if (!audioBuffer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No audio file found' }));
        return;
      }

      try {
        const text = await transcribe(audioBuffer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (err) {
        console.error('Transcription error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Transcription failed' }));
      }
    });
    return;
  }

  // ---- Assistant Files API ----
  // GET /api/files - list files in assistant directory
  if (pathname === '/api/files' && req.method === 'GET') {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const result = {
        exists: existsSync(ASSISTANT_DIR),
        files: {},
        logs: [],
        notes: []
      };

      // Check main files
      const mainFiles = ['CLAUDE.md', 'MEMORY.md', 'USER.md'];
      for (const f of mainFiles) {
        const fp = join(ASSISTANT_DIR, f);
        if (existsSync(fp)) {
          result.files[f] = {
            exists: true,
            size: statSync(fp).size,
            mtime: statSync(fp).mtime
          };
        } else {
          result.files[f] = { exists: false };
        }
      }

      // Check today's log
      const todayLogPath = join(ASSISTANT_DIR, 'logs', `${today}.md`);
      result.todayLog = {
        exists: existsSync(todayLogPath),
        date: today
      };

      // List logs directory
      const logsDir = join(ASSISTANT_DIR, 'logs');
      if (existsSync(logsDir) && statSync(logsDir).isDirectory()) {
        const entries = readdirSync(logsDir);
        for (const e of entries) {
          if (e.endsWith('.md')) {
            const fp = join(logsDir, e);
            result.logs.push({
              name: e,
              mtime: statSync(fp).mtime
            });
          }
        }
        result.logs.sort((a, b) => b.name.localeCompare(a.name)); // newest first
      }

      // List notes directory
      const notesDir = join(ASSISTANT_DIR, 'notes');
      if (existsSync(notesDir) && statSync(notesDir).isDirectory()) {
        const entries = readdirSync(notesDir);
        for (const e of entries) {
          if (e.endsWith('.md')) {
            const fp = join(notesDir, e);
            result.notes.push({
              name: e,
              mtime: statSync(fp).mtime
            });
          }
        }
        result.notes.sort((a, b) => a.name.localeCompare(b.name));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Error reading assistant files:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read assistant files' }));
    }
    return;
  }

  // GET /api/files/content?f=filename - read a specific file
  if (pathname === '/api/files/content' && req.method === 'GET') {
    const fileParam = parsedUrl.query.f;
    if (!fileParam) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing file parameter' }));
      return;
    }

    // Validate: only allow .md files, no path traversal
    if (!fileParam.endsWith('.md') || fileParam.includes('..') || fileParam.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }

    // Determine file path based on type
    let filePath;
    if (fileParam.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
      // It's a log file
      filePath = join(ASSISTANT_DIR, 'logs', fileParam);
    } else {
      // Main file or note
      const mainFiles = ['CLAUDE.md', 'MEMORY.md', 'USER.md'];
      if (mainFiles.includes(fileParam)) {
        filePath = join(ASSISTANT_DIR, fileParam);
      } else {
        // It's a note
        filePath = join(ASSISTANT_DIR, 'notes', fileParam);
      }
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content, file: fileParam }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read file' }));
    }
    return;
  }

  // POST /api/files/init - initialize assistant directory
  if (pathname === '/api/files/init' && req.method === 'POST') {
    try {
      if (!existsSync(ASSISTANT_DIR)) {
        mkdirSync(ASSISTANT_DIR, { recursive: true });
      }
      const logsDir = join(ASSISTANT_DIR, 'logs');
      const notesDir = join(ASSISTANT_DIR, 'notes');
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });

      // Create default CLAUDE.md if not exists
      const claudeMdPath = join(ASSISTANT_DIR, 'CLAUDE.md');
      if (!existsSync(claudeMdPath)) {
        const defaultClaudeMd = `# Personal Assistant Rules

## Identity
You are the user's personal assistant, focused on helping with development tasks and thought collection.

## Session End Protocol
每次对话结束前，执行以下步骤：
1. 将本次对话的核心内容追加到 logs/YYYY-MM-DD.md
2. 判断是否有值得更新的用户偏好/习惯 → 更新 USER.md
3. 判断是否有值得长期记忆的结论/想法 → 更新 MEMORY.md
4. 如果出现明确的主题性内容，在 notes/ 下创建或更新对应 .md 文件

## Session Start Protocol
每次 session 开始时，读取 MEMORY.md 和 USER.md，作为上下文背景。
`;
        writeFileSync(claudeMdPath, defaultClaudeMd, 'utf8');
      }

      // Create empty MEMORY.md and USER.md if not exists
      const memoryPath = join(ASSISTANT_DIR, 'MEMORY.md');
      if (!existsSync(memoryPath)) {
        writeFileSync(memoryPath, '# 长期记忆\n\n跨 session 的重要信息、结论、偏好。\n\n', 'utf8');
      }

      const userPath = join(ASSISTANT_DIR, 'USER.md');
      if (!existsSync(userPath)) {
        writeFileSync(userPath, '# 用户画像\n\n兴趣、习惯、沟通风格。\n\n', 'utf8');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Assistant directory initialized' }));
    } catch (err) {
      console.error('Error initializing assistant directory:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to initialize' }));
    }
    return;
  }

  // POST /api/files/save - save current conversation to memory files
  if (pathname === '/api/files/save' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 10240); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
      return;
    }

    try {
      const { sessionId, summary, noteName, memoryUpdate, userUpdate } = JSON.parse(body);
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId required' }));
        return;
      }

      // Check if session is running in assistant directory
      const session = getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      // Normalize paths for comparison
      const normalizedFolder = resolve(session.folder);
      const normalizedAssistant = resolve(ASSISTANT_DIR);
      if (normalizedFolder !== normalizedAssistant) {
        // Session is not running in assistant directory - silently ignore
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, skipped: true, reason: 'Not assistant session' }));
        return;
      }

      // Load conversation history
      const historyPath = join(CHAT_HISTORY_DIR, `${sessionId}.json`);
      if (!existsSync(historyPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session history not found' }));
        return;
      }

      const events = JSON.parse(readFileSync(historyPath, 'utf8'));

      // Format conversation for log
      const today = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

      // Build conversation text from events
      let conversationText = '';
      for (const ev of events) {
        if (ev.type === 'message') {
          const role = ev.role === 'user' ? '用户' : 'AI';
          conversationText += `**${role}**: ${ev.content}\n\n`;
        }
      }

      // Ensure directories exist
      const logsDir = join(ASSISTANT_DIR, 'logs');
      const notesDir = join(ASSISTANT_DIR, 'notes');
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });

      // Build log entry with sessionId marker for future updates
      const logEntry = `\n---\n\n<!-- session:${sessionId} -->\n\n## ${timestamp}\n\n${conversationText}`;
      const logPath = join(logsDir, `${today}.md`);

      if (!existsSync(logPath)) {
        // Create new log file
        writeFileSync(logPath, `# ${today}\n${logEntry}`, 'utf8');
      } else {
        // Check if this session already has an entry today
        let existingLog = readFileSync(logPath, 'utf8');
        const sessionMarker = `<!-- session:${sessionId} -->`;

        if (existingLog.includes(sessionMarker)) {
          // Replace existing entry for this session
          // Pattern: ---\n\n<!-- session:xxx -->\n\n## HH:MM\n\n**content**
          const entryPattern = new RegExp(
            `\\n---\\n\\n${sessionMarker}\\n\\n## \\d{2}:\\d{2}\\n\\n([\\s\\S]*?)(?=\\n---\\n\\n<!-- session:|$)`,
            'g'
          );
          existingLog = existingLog.replace(entryPattern, logEntry + '\n');
          writeFileSync(logPath, existingLog, 'utf8');
        } else {
          // Append new entry
          appendFileSync(logPath, logEntry, 'utf8');
        }
      }

      // Update MEMORY.md if provided
      if (memoryUpdate) {
        const memoryPath = join(ASSISTANT_DIR, 'MEMORY.md');
        const existing = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf8') : '';
        writeFileSync(memoryPath, existing + `\n\n${memoryUpdate}`, 'utf8');
      }

      // Update USER.md if provided
      if (userUpdate) {
        const userPath = join(ASSISTANT_DIR, 'USER.md');
        const existing = existsSync(userPath) ? readFileSync(userPath, 'utf8') : '';
        writeFileSync(userPath, existing + `\n\n${userUpdate}`, 'utf8');
      }

      // Create note if provided
      if (noteName && summary) {
        const notePath = join(notesDir, `${noteName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')}.md`);
        writeFileSync(notePath, `# ${noteName}\n\n${summary}\n`, 'utf8');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, savedTo: `${today}.md` }));
    } catch (err) {
      console.error('Error saving to memory:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to save' }));
    }
    return;
  }

  // ---- Inbox API ----
  // GET /api/inbox - get today's inbox items
  if (pathname === '/api/inbox' && req.method === 'GET') {
    try {
      const items = getTodayInbox();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items }));
    } catch (err) {
      console.error('Error reading inbox:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read inbox' }));
    }
    return;
  }

  // POST /api/inbox - add a new inbox item
  if (pathname === '/api/inbox' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 4096); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
      return;
    }
    try {
      const { content, title } = JSON.parse(body);
      if (!content || typeof content !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'content is required' }));
        return;
      }
      const item = addInboxItem(content, title);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ item }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
    return;
  }

  // DELETE /api/inbox/:id - delete an inbox item
  if (pathname.startsWith('/api/inbox/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const ok = deleteInboxItem(id);
    if (ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Item not found' }));
    }
    return;
  }

  // Push notification API
  if (pathname === '/api/push/vapid-public-key' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ publicKey: getPublicKey() }));
    return;
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 4096); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
      return;
    }
    try {
      const sub = JSON.parse(body);
      if (!sub.endpoint) throw new Error('Missing endpoint');
      addSubscription(sub);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid subscription' }));
    }
    return;
  }

  // Main page (chat UI) — read from disk each time for hot-reload
  if (pathname === '/') {
    try {
      const chatPage = readFileSync(chatTemplatePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(chatPage.replace(/\{\{NONCE\}\}/g, nonce));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to load chat page');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// Extract file from multipart form data
function extractMultipartFile(buffer, boundary) {
  const boundaryBytes = Buffer.from('--' + boundary);
  let start = buffer.indexOf(Buffer.from('\r\n\r\n'));
  if (start === -1) return null;
  start += 4;
  const endBoundary = Buffer.from('\r\n--' + boundary);
  const end = buffer.indexOf(endBoundary, start);
  if (end === -1) return null;
  return buffer.subarray(start, end);
}

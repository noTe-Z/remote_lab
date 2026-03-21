#!/usr/bin/env node
/**
 * 批量导入历史 chat history 到 OBSERVATIONS.md
 *
 * 用法: node scripts/import-history.mjs [--dry-run] [--start-date YYYY-MM-DD]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  chatHistoryDir: join(homedir(), '.config', 'claude-web', 'chat-history'),
  sessionsFile: join(homedir(), '.config', 'claude-web', 'chat-sessions.json'),
  observationsPath: join(homedir(), 'Development', 'assistant', 'contexts', 'memory', 'OBSERVATIONS.md'),
  claudeCmd: join(homedir(), '.local', 'bin', 'claude'),
};

// 解析参数
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    startDate: args.includes('--start-date') ? args[args.indexOf('--start-date') + 1] : null,
  };
}

// 获取所有历史文件，按日期分组
function getHistoryByDate() {
  const files = readdirSync(CONFIG.chatHistoryDir).filter(f => f.endsWith('.json'));
  const byDate = {};

  for (const file of files) {
    const filePath = join(CONFIG.chatHistoryDir, file);
    const stats = statSync(filePath);
    const date = new Date(stats.mtimeMs).toISOString().split('T')[0];

    if (!byDate[date]) byDate[date] = [];
    byDate[date].push({ file, filePath, mtime: stats.mtimeMs });
  }

  // 按日期排序
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [date, files]) => ({ ...acc, [date]: files }), {});
}

// 提取单个 session 的摘要
function extractSessionSummary(filePath) {
  try {
    const events = JSON.parse(readFileSync(filePath, 'utf8'));

    const userMessages = events
      .filter(e => e.type === 'message' && e.role === 'user')
      .map(e => (e.content || '').slice(0, 300))
      .slice(0, 5);

    const toolUses = events
      .filter(e => e.type === 'tool_use')
      .map(e => e.toolName)
      .filter((v, i, a) => a.indexOf(v) === i);

    const fileChanges = events
      .filter(e => e.type === 'file_change' || (e.type === 'tool_result' && e.filePath))
      .slice(0, 5);

    return { userMessages, toolUses, fileChanges };
  } catch {
    return null;
  }
}

// 获取 session 文件夹
function getSessionFolder(sessionId) {
  try {
    const sessions = JSON.parse(readFileSync(CONFIG.sessionsFile, 'utf8'));
    const session = sessions.find(s => s.id === sessionId);
    return session?.folder || 'unknown';
  } catch {
    return 'unknown';
  }
}

// 检查日期是否已有记录
function hasEntryForDate(date) {
  if (!existsSync(CONFIG.observationsPath)) return false;
  const content = readFileSync(CONFIG.observationsPath, 'utf8');
  return content.includes(`Date: ${date}`);
}

// 调用 Claude 提炼观察
async function extractObservations(sessions, date) {
  const summaries = sessions.map(s => {
    const summary = extractSessionSummary(s.filePath);
    if (!summary) return null;
    const folder = getSessionFolder(s.file.replace('.json', ''));
    return `
### Session (${folder})
- User: ${summary.userMessages.slice(0, 2).join(' | ') || '(none)'}
- Tools: ${summary.toolUses.slice(0, 5).join(', ') || '(none)'}
`;
  }).filter(Boolean).join('\n');

  const prompt = `你是一个记忆提取系统。分析以下 ${date} 的对话记录，提取值得记录的观察。

## 对话摘要
${summaries}

## 输出格式
按以下格式输出观察，每种最多 3 条：

🔴 High: [方法论/约束] 描述（永久保留）
🟡 Medium: [项目状态/决策] 描述（几周内参考）
🟢 Low: [任务流水] 描述（定期 GC）

## 筛选标准
- 🔴 High: 跨项目通用、多次验证的方法论或决策原则
- 🟡 Medium: 特定项目的进展、决策或待办
- 🟢 Low: 具体任务执行、临时状态

## 注意
- 只记录有价值的观察，不要流水账
- 每条观察一句话，简洁明了
- 如果没有值得记录的内容，输出 "(no observations)"

只输出观察结果。`;

  return new Promise((resolve, reject) => {
    const proc = spawn(CONFIG.claudeCmd, ['-p', prompt, '--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();
    let output = '';
    proc.stdout.on('data', (c) => output += c.toString());
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code !== 0 && !output) reject(new Error(`Exit ${code}`));
      else resolve(output);
    });
  });
}

// 追加观察
function appendObservations(date, observations) {
  const entry = `

---

Date: ${date}

${observations}
`;
  appendFileSync(CONFIG.observationsPath, entry, 'utf8');
}

async function main() {
  const { dryRun, startDate } = parseArgs();

  console.log('Scanning chat history...');
  const historyByDate = getHistoryByDate();

  const dates = Object.keys(historyByDate)
    .filter(d => !startDate || d >= startDate)
    .filter(d => !hasEntryForDate(d));

  console.log(`Found ${dates.length} dates to process`);

  for (const date of dates) {
    const sessions = historyByDate[date];
    console.log(`\nProcessing ${date} (${sessions.length} sessions)...`);

    try {
      const observations = await extractObservations(sessions, date);

      if (!observations || observations.includes('(no observations)')) {
        console.log(`  No observations for ${date}`);
        continue;
      }

      console.log(`  Observations:\n${observations.split('\n').map(l => '    ' + l).join('\n')}`);

      if (dryRun) {
        console.log(`  [DRY RUN] Would append to OBSERVATIONS.md`);
      } else {
        appendObservations(date, observations.trim());
        console.log(`  Appended to OBSERVATIONS.md`);
      }
    } catch (err) {
      console.error(`  Failed: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main();
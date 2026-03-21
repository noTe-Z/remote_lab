#!/usr/bin/env node
/**
 * Observer - 每日观察提取
 *
 * 扫描最近的对话历史，提取有价值的观察，追加到 OBSERVATIONS.md
 *
 * 用法: node scripts/observer.mjs [--date YYYY-MM-DD] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置
const CONFIG = {
  chatHistoryDir: join(homedir(), '.config', 'claude-web', 'chat-history'),
  sessionsFile: join(homedir(), '.config', 'claude-web', 'chat-sessions.json'),
  observationsPath: join(homedir(), 'Development', 'assistant', 'contexts', 'memory', 'OBSERVATIONS.md'),
  claudeCmd: join(homedir(), '.local', 'bin', 'claude'),
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { date: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      result.date = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    }
  }

  if (!result.date) {
    const now = new Date();
    result.date = now.toISOString().split('T')[0];
  }

  return result;
}

// 获取最近 24 小时的对话历史
function getRecentHistory(hoursBack = 24) {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const sessions = [];

  if (!existsSync(CONFIG.chatHistoryDir)) {
    return sessions;
  }

  const files = readdirSync(CONFIG.chatHistoryDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(CONFIG.chatHistoryDir, file);
    const stats = statSync(filePath);

    if (stats.mtimeMs < cutoff) continue;

    try {
      const content = readFileSync(filePath, 'utf8');
      const events = JSON.parse(content);

      // 提取关键信息
      const userMessages = events
        .filter(e => e.type === 'message' && e.role === 'user')
        .map(e => e.content || '')
        .slice(0, 10); // 最多取 10 条

      const assistantMessages = events
        .filter(e => e.type === 'message' && e.role === 'assistant')
        .map(e => (e.content || '').slice(0, 200))
        .slice(0, 10);

      const toolUses = events
        .filter(e => e.type === 'tool_use')
        .map(e => e.toolName)
        .filter((v, i, a) => a.indexOf(v) === i); // 去重

      const fileChanges = events
        .filter(e => e.type === 'file_change')
        .map(e => `${e.changeType}: ${e.filePath}`);

      sessions.push({
        sessionId: file.replace('.json', ''),
        userMessages,
        assistantMessages: assistantMessages.slice(0, 3), // 只取前 3 条
        toolUses: toolUses.slice(0, 10),
        fileChanges: fileChanges.slice(0, 10),
        mtime: stats.mtimeMs,
      });
    } catch (e) {
      // 跳过解析失败的文件
    }
  }

  return sessions.sort((a, b) => b.mtime - a.mtime);
}

// 获取 session 的文件夹信息
function getSessionFolder(sessionId) {
  try {
    const sessions = JSON.parse(readFileSync(CONFIG.sessionsFile, 'utf8'));
    const session = sessions.find(s => s.id === sessionId);
    return session?.folder || 'unknown';
  } catch {
    return 'unknown';
  }
}

// 检查是否已有当天的记录
function hasEntryForDate(date) {
  if (!existsSync(CONFIG.observationsPath)) return false;
  const content = readFileSync(CONFIG.observationsPath, 'utf8');
  return content.includes(`Date: ${date}`);
}

// 调用 Claude 进行观察提取
async function extractObservations(sessions, targetDate) {
  if (sessions.length === 0) {
    console.log('No sessions to analyze');
    return null;
  }

  // 构建摘要
  const sessionSummaries = sessions.map(s => {
    const folder = getSessionFolder(s.sessionId);
    return `
### Session (${folder})
- User: ${s.userMessages.slice(0, 3).join(' | ') || '(none)'}
- Tools: ${s.toolUses.join(', ') || '(none)'}
- Files: ${s.fileChanges.slice(0, 5).join('; ') || '(none)'}
`.trim();
  }).join('\n\n');

  const prompt = `你是一个记忆提取系统。分析以下对话记录，提取值得记录的观察。

目标日期: ${targetDate}

## 最近对话摘要
${sessionSummaries}

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
- 使用相对路径（如 remotelab/chat/router.mjs）
- 如果没有值得记录的内容，输出 "(no observations)"

只输出观察结果，不要解释。`;

  console.log('Calling Claude to extract observations...');

  return new Promise((resolve, reject) => {
    const proc = spawn(CONFIG.claudeCmd, [
      '-p', prompt,
      '--print',  // 使用 print 模式，直接输出文本
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();

    let output = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', reject);

    proc.on('exit', (code) => {
      if (code !== 0 && !output) {
        console.error('Claude stderr:', stderr.slice(0, 500));
        reject(new Error(`Claude exited with code ${code}`));
      } else {
        resolve(output);
      }
    });
  });
}

// 追加观察到 OBSERVATIONS.md
function appendObservations(date, observations) {
  const dir = dirname(CONFIG.observationsPath);
  if (!existsSync(dir)) {
    // 不自动创建目录，应该由用户创建
    console.error(`Directory not found: ${dir}`);
    console.error('Please ensure the assistant context infrastructure is set up.');
    process.exit(1);
  }

  const entry = `
---

Date: ${date}

${observations}
`;

  appendFileSync(CONFIG.observationsPath, entry, 'utf8');
  console.log(`Appended observations for ${date} to ${CONFIG.observationsPath}`);
}

// 主函数
async function main() {
  const { date, dryRun } = parseArgs();

  console.log(`Observer running for date: ${date}`);

  // 幂等性检查
  if (hasEntryForDate(date)) {
    console.log(`Entry for ${date} already exists, skipping.`);
    return;
  }

  // 获取最近的对话历史
  const sessions = getRecentHistory(24);
  console.log(`Found ${sessions.length} sessions in the last 24 hours`);

  if (sessions.length === 0) {
    console.log('No sessions to analyze, exiting.');
    return;
  }

  // 提取观察
  try {
    const observations = await extractObservations(sessions, date);

    if (!observations || observations.trim() === '' || observations.includes('(no observations)')) {
      console.log('No observations to record.');
      return;
    }

    console.log('\nExtracted observations:');
    console.log(observations);

    if (dryRun) {
      console.log('\n[DRY RUN] Would append to OBSERVATIONS.md');
    } else {
      appendObservations(date, observations.trim());
    }
  } catch (err) {
    console.error('Failed to extract observations:', err.message);
    process.exit(1);
  }
}

main();
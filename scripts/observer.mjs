#!/usr/bin/env node
/**
 * Observer - 每日观察提取
 *
 * 极简触发器：让 AI Agent 自主扫描、分析、写入
 *
 * 用法: node scripts/observer.mjs [--date YYYY-MM-DD] [--dry-run]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { addInboxItem } from '../chat/inbox.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 获取 assistant 目录路径（支持环境变量）
function getAssistantDir() {
  const envDir = process.env.ASSISTANT_DIR;
  if (envDir) {
    return envDir.startsWith('~')
      ? join(homedir(), envDir.slice(1))
      : envDir;
  }
  return join(homedir(), 'Development', 'assistant');
}

const ASSISTANT_DIR = getAssistantDir();

// 配置
const CONFIG = {
  chatHistoryDir: join(homedir(), '.config', 'claude-web', 'chat-history'),
  knowledgeDir: join(ASSISTANT_DIR, 'knowledge'),
  observationsPath: join(ASSISTANT_DIR, 'contexts', 'memory', 'OBSERVATIONS.md'),
  sopPath: join(ASSISTANT_DIR, 'rules', 'observer-sop.md'),
  agentsPath: join(ASSISTANT_DIR, 'AGENTS.md'),
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
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    result.date = `${year}-${month}-${day}`;
  }

  return result;
}

// 检查是否已有当天的记录
function hasEntryForDate(date) {
  if (!existsSync(CONFIG.observationsPath)) return false;
  const content = readFileSync(CONFIG.observationsPath, 'utf8');
  return content.includes(`Date: ${date}`);
}

// 提取当天的 observation 内容
function extractObservationForDate(date) {
  if (!existsSync(CONFIG.observationsPath)) return null;
  const content = readFileSync(CONFIG.observationsPath, 'utf8');

  // 找到目标日期的 entry
  const dateMarker = `Date: ${date}`;
  const startIndex = content.indexOf(dateMarker);
  if (startIndex === -1) return null;

  // 找到下一个日期分隔符或文件结束
  const nextSeparator = content.indexOf('\n---\n\nDate:', startIndex);
  const endIndex = nextSeparator === -1 ? content.length : nextSeparator;

  const entry = content.slice(startIndex, endIndex).trim();

  // 提取标题（第一行 High 或 Medium）
  const lines = entry.split('\n').filter(l => l.trim());
  const firstSubstantive = lines.find(l => l.startsWith('🔴') || l.startsWith('🟡'));
  const title = firstSubstantive
    ? firstSubstantive.replace(/^[🔴🟡]\s*(High|Medium):\s*/, '').slice(0, 50)
    : `Observations for ${date}`;

  return { title, content: entry };
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

  // 构建 prompt
  const prompt = `你是 L1 Observer Agent。

【目标日期】: ${date}（北京时间）

【SOP 路径】: ${CONFIG.sopPath}

【任务】:
1. 读取 SOP 文件了解规则
2. 可选：读取 ${CONFIG.agentsPath} 了解项目背景
3. 自主扫描数据源：
   - Chat History: ${CONFIG.chatHistoryDir}
   - Knowledge Base: ${CONFIG.knowledgeDir}
4. 筛选目标日期内的内容并提取观察
5. PREPEND 到 ${CONFIG.observationsPath}（在 \`<!-- 以下是记录区域 -->\` 之后插入）

【筛选约束】:
- 只关注北京时间 ${date} 的内容
- Chat history 消息用 timestamp 字段（毫秒）判断日期
- Knowledge 用 find -mtime 判断修改日期

完成后给出简短总结。`;

  if (dryRun) {
    console.log('\n[DRY RUN] Prompt:\n');
    console.log(prompt);
    return;
  }

  console.log('\nTriggering AI Agent...\n');

  // 调用 Claude Code（允许工具）
  const proc = spawn(CONFIG.claudeCmd, [
    '-p', prompt,
    '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash',
  ], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  proc.on('error', (err) => {
    console.error('Failed to start Claude:', err.message);
    process.exit(1);
  });

  proc.on('exit', (code) => {
    if (code === 0) {
      // Agent 成功完成，同步到 inbox
      const obs = extractObservationForDate(date);
      if (obs) {
        try {
          addInboxItem(obs.content, obs.title, { type: 'observer' });
          console.log(`\nSynced observation to inbox for ${date}`);
        } catch (err) {
          console.error('Failed to sync to inbox:', err.message);
        }
      }
    }
    process.exit(code || 0);
  });
}

main();
#!/usr/bin/env node
/**
 * Reflector - 每周反思与晋升
 *
 * 分析 OBSERVATIONS.md 中的观察，将普适性内容晋升到 rules/
 * 同时进行垃圾回收，清理已处理和过期的记录
 *
 * 用法: node scripts/reflector.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置
const CONFIG = {
  observationsPath: join(homedir(), 'Development', 'assistant', 'contexts', 'memory', 'OBSERVATIONS.md'),
  rulesDir: join(homedir(), 'Development', 'assistant', 'rules'),
  claudeCmd: join(homedir(), '.local', 'bin', 'claude'),
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  return { dryRun: args.includes('--dry-run') };
}

// 读取当前的观察
function readObservations() {
  if (!existsSync(CONFIG.observationsPath)) {
    return { content: '', entries: [] };
  }

  const content = readFileSync(CONFIG.observationsPath, 'utf8');

  // 解析条目
  const entries = [];
  const blocks = content.split(/---\s*\n/).filter(b => b.trim());

  for (const block of blocks) {
    const dateMatch = block.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const date = dateMatch[1];
    const lines = block.split('\n').filter(l => l.trim());

    for (const line of lines) {
      if (line.startsWith('🔴') || line.startsWith('🟡') || line.startsWith('🟢')) {
        const match = line.match(/^([🔴🟡🟢])\s*(High|Medium|Low):\s*\[([^\]]+)\]\s*(.+)/);
        if (match) {
          entries.push({
            date,
            priority: match[1],
            level: match[2],
            category: match[3],
            content: match[4],
            raw: line,
          });
        }
      }
    }
  }

  return { content, entries };
}

// 调用 Claude 进行反思和晋升分析
async function analyzeAndReflect(entries) {
  if (entries.length === 0) {
    console.log('No entries to analyze');
    return null;
  }

  // 按优先级分组
  const highEntries = entries.filter(e => e.priority === '🔴');
  const mediumEntries = entries.filter(e => e.priority === '🟡');
  const lowEntries = entries.filter(e => e.priority === '🟢');

  const entriesText = `
## 🔴 High Priority (${highEntries.length})
${highEntries.map(e => `- [${e.date}] [${e.category}] ${e.content}`).join('\n') || '(none)'}

## 🟡 Medium Priority (${mediumEntries.length})
${mediumEntries.map(e => `- [${e.date}] [${e.category}] ${e.content}`).join('\n') || '(none)'}

## 🟢 Low Priority (${lowEntries.length})
${lowEntries.slice(0, 20).map(e => `- [${e.date}] [${e.category}] ${e.content}`).join('\n') || '(none)'}${lowEntries.length > 20 ? `\n... and ${lowEntries.length - 20} more` : ''}
`;

  const prompt = `你是一个记忆管理系统。分析以下观察记录，执行反思和晋升任务。

${entriesText}

## 任务

### 1. 晋升分析
找出值得晋升为 axiom（决策原则）的内容。晋升门槛：
- 跨项目通用
- 多次验证
- 有明确适用场景

输出格式：
\`\`\`axiom
[category] 内容
\`\`\`

### 2. 垃圾回收建议
识别可以删除的记录：
- 已晋升的内容
- 过期的 🟢 Low 记录（超过 2 周）
- 重复的内容

输出格式：
\`\`\`gc
- [日期] 内容摘要
\`\`\`

### 3. 保留建议
哪些内容应该保留，为什么。

## 输出格式
只输出分析结果，使用上述代码块格式。不要解释。`;

  console.log('Calling Claude to analyze and reflect...');

  return new Promise((resolve, reject) => {
    const proc = spawn(CONFIG.claudeCmd, [
      '-p', prompt,
      '--print',
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

// 解析分析结果
function parseAnalysisResult(result) {
  const axioms = [];
  const gcItems = [];

  // 提取 axioms
  const axiomMatches = result.matchAll(/```axiom\s*\n([\s\S]*?)```/g);
  for (const match of axiomMatches) {
    const lines = match[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        const parsed = trimmed.match(/^\[([^\]]+)\]\s*(.+)/);
        if (parsed) {
          axioms.push({ category: parsed[1], content: parsed[2] });
        }
      }
    }
  }

  // 提取 gc items
  const gcMatches = result.matchAll(/```gc\s*\n([\s\S]*?)```/g);
  for (const match of gcMatches) {
    const lines = match[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-')) {
        gcItems.push(trimmed.slice(1).trim());
      }
    }
  }

  return { axioms, gcItems };
}

// 将 axiom 追加到 INDEX.md
function appendAxioms(axioms) {
  const axiomIndexPath = join(CONFIG.rulesDir, 'axioms', 'INDEX.md');

  if (!existsSync(axiomIndexPath)) {
    console.log('Axiom INDEX.md not found, skipping axiom append.');
    return;
  }

  const current = readFileSync(axiomIndexPath, 'utf8');
  const newAxioms = axioms.map(a => `- [${a.category}] ${a.content}`).join('\n');

  // 找到合适的插入位置（在现有 axioms 之后）
  const lines = current.split('\n');
  let insertIndex = lines.length;

  // 找到最后一个 axiom 条目的位置
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^-\s*\[/)) {
      insertIndex = i + 1;
      break;
    }
  }

  lines.splice(insertIndex, 0, newAxioms);
  writeFileSync(axiomIndexPath, lines.join('\n'), 'utf8');

  console.log(`Appended ${axioms.length} axioms to ${axiomIndexPath}`);
}

// 执行垃圾回收
function garbageCollect(content, gcItems) {
  // 简单实现：删除包含 gcItem 中关键词的行
  // 实际应用中可能需要更精确的匹配
  const lines = content.split('\n');
  const filtered = lines.filter(line => {
    if (!line.startsWith('🔴') && !line.startsWith('🟡') && !line.startsWith('🟢')) {
      return true;
    }
    // 检查是否在 gc 列表中
    const content = line.slice(10).toLowerCase();
    return !gcItems.some(item => content.includes(item.toLowerCase()));
  });

  return filtered.join('\n');
}

// 主函数
async function main() {
  const { dryRun } = parseArgs();

  console.log('Reflector running...');

  // 读取观察
  const { content, entries } = readObservations();
  console.log(`Found ${entries.length} entries in OBSERVATIONS.md`);

  if (entries.length === 0) {
    console.log('No entries to analyze, exiting.');
    return;
  }

  // 分析和反思
  try {
    const result = await analyzeAndReflect(entries);

    if (!result) {
      console.log('No analysis result.');
      return;
    }

    console.log('\nAnalysis result:');
    console.log(result);

    const { axioms, gcItems } = parseAnalysisResult(result);

    console.log(`\nFound ${axioms.length} axioms to promote, ${gcItems.length} items to GC`);

    if (dryRun) {
      console.log('\n[DRY RUN] Would make the following changes:');
      if (axioms.length > 0) {
        console.log('\nAxioms to add:');
        axioms.forEach(a => console.log(`  - [${a.category}] ${a.content}`));
      }
      if (gcItems.length > 0) {
        console.log('\nItems to GC:');
        gcItems.forEach(i => console.log(`  - ${i}`));
      }
    } else {
      // 执行晋升
      if (axioms.length > 0) {
        appendAxioms(axioms);
      }

      // 执行垃圾回收
      if (gcItems.length > 0) {
        const cleaned = garbageCollect(content, gcItems);
        writeFileSync(CONFIG.observationsPath, cleaned, 'utf8');
        console.log(`Garbage collected ${gcItems.length} items from OBSERVATIONS.md`);
      }
    }
  } catch (err) {
    console.error('Failed to analyze:', err.message);
    process.exit(1);
  }
}

main();
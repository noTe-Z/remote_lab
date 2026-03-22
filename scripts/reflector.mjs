#!/usr/bin/env node
/**
 * Reflector - 每周反思与晋升
 *
 * 分析 OBSERVATIONS.md 中的观察，将普适性内容晋升到 rules/
 * 同时创建 Reflector 类型的 inbox item 供用户审核
 * Skill 候选写入 draft/ 目录，待用户确认后移动到 skills/
 *
 * 用法: node scripts/reflector.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

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
  observationsPath: join(ASSISTANT_DIR, 'contexts', 'memory', 'OBSERVATIONS.md'),
  rulesDir: join(ASSISTANT_DIR, 'rules'),
  draftDir: join(ASSISTANT_DIR, 'draft'),
  inboxFile: join(homedir(), '.config', 'claude-web', 'inbox.json'),
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

### 1. Skill 候选识别
找出值得沉淀为 skill 的内容。Skill 是可复用的方法论或工作流。
输出格式：
\`\`\`skill
# Skill 标题

## When to Use
什么情况下触发这个 skill

## 步骤
1. 步骤一
2. 步骤二
\`\`\`

### 2. Axiom 候选识别
找出值得晋升为 axiom（决策原则）的内容。晋升门槛：
- 跨项目通用
- 多次验证
- 有明确适用场景

输出格式：
\`\`\`axiom
[category] 内容
\`\`\`

### 3. 垃圾回收建议
识别可以删除的记录：
- 已晋升的内容
- 过期的 🟢 Low 记录（超过 2 周）
- 重复的内容

输出格式：
\`\`\`gc
- [日期] 内容摘要
\`\`\`

### 4. 总结
为用户生成一份简洁的总结报告，说明：
- 发现了多少个 skill 候选
- 发现了多少个 axiom 候选
- 建议删除多少条记录

## 输出格式
按上述代码块格式输出分析结果。每个 skill 单独一个代码块。`;

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
  const skills = [];
  const axioms = [];
  const gcItems = [];
  let summary = '';

  // 提取 skills
  const skillMatches = result.matchAll(/```skill\s*\n([\s\S]*?)```/g);
  for (const match of skillMatches) {
    skills.push(match[1].trim());
  }

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

  // 提取总结（最后一个非代码块内容）
  const parts = result.split(/```[\s\S]*?```/);
  if (parts.length > 0) {
    summary = parts[parts.length - 1].trim();
  }

  return { skills, axioms, gcItems, summary };
}

// 将 skill 写入 draft 目录
function writeSkillsToDraft(skills) {
  if (skills.length === 0) return [];

  // 确保 draft 目录存在
  if (!existsSync(CONFIG.draftDir)) {
    mkdirSync(CONFIG.draftDir, { recursive: true });
  }

  const writtenFiles = [];
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < skills.length; i++) {
    const skillContent = skills[i];
    // 从第一行提取标题
    const titleMatch = skillContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : `skill-${i + 1}`;
    // 生成安全的文件名
    const safeName = title.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const filename = `${today}-${safeName}.md`;
    const filepath = join(CONFIG.draftDir, filename);

    writeFileSync(filepath, skillContent, 'utf8');
    writtenFiles.push({ filename, title });
    console.log(`Wrote skill draft: ${filename}`);
  }

  return writtenFiles;
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

// 创建 Reflector 类型的 inbox item
function createReflectorInboxItem(skills, axioms, gcItems, summary, draftFiles) {
  // 读取现有 inbox
  let items = [];
  if (existsSync(CONFIG.inboxFile)) {
    try {
      items = JSON.parse(readFileSync(CONFIG.inboxFile, 'utf8'));
    } catch {
      items = [];
    }
  }

  // 构建内容
  const today = new Date().toISOString().slice(0, 10);
  let content = `## Reflector 周报 (${today})\n\n`;
  content += summary ? `${summary}\n\n` : '';
  content += `### 统计\n`;
  content += `- Skill 候选: ${skills.length} 个\n`;
  content += `- Axiom 候选: ${axioms.length} 个\n`;
  content += `- 建议删除: ${gcItems.length} 条\n`;

  if (draftFiles.length > 0) {
    content += `\n### Draft 文件\n`;
    for (const f of draftFiles) {
      content += `- \`${f.filename}\`: ${f.title}\n`;
    }
  }

  // 创建新的 inbox item
  const item = {
    id: randomBytes(8).toString('hex'),
    title: `Reflector: ${today}`,
    content: content,
    created: new Date().toISOString(),
    date: today,
    type: 'reflector',
    metadata: {
      source: 'reflector',
      skillsCount: skills.length,
      axiomsCount: axioms.length,
      gcCount: gcItems.length,
      draftFiles: draftFiles.map(f => f.filename),
    }
  };

  items.push(item);

  // 确保 inbox 目录存在
  const inboxDir = dirname(CONFIG.inboxFile);
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }

  writeFileSync(CONFIG.inboxFile, JSON.stringify(items, null, 2), 'utf8');
  console.log(`Created reflector inbox item: ${item.id}`);
  return item;
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
    const lineContent = line.slice(10).toLowerCase();
    return !gcItems.some(item => lineContent.includes(item.toLowerCase()));
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

    const { skills, axioms, gcItems, summary } = parseAnalysisResult(result);

    console.log(`\nFound ${skills.length} skill candidates, ${axioms.length} axioms, ${gcItems.length} items to GC`);

    if (dryRun) {
      console.log('\n[DRY RUN] Would make the following changes:');
      if (skills.length > 0) {
        console.log('\nSkills to write to draft/:');
        skills.forEach((s, i) => console.log(`  ${i + 1}. ${s.split('\n')[0]}`));
      }
      if (axioms.length > 0) {
        console.log('\nAxioms to add:');
        axioms.forEach(a => console.log(`  - [${a.category}] ${a.content}`));
      }
      if (gcItems.length > 0) {
        console.log('\nItems to GC:');
        gcItems.forEach(i => console.log(`  - ${i}`));
      }
    } else {
      let draftFiles = [];

      // 写 skill 到 draft 目录
      if (skills.length > 0) {
        draftFiles = writeSkillsToDraft(skills);
      }

      // 执行 axiom 晋升（自动，用户可在 inbox 中查看）
      if (axioms.length > 0) {
        appendAxioms(axioms);
      }

      // 执行垃圾回收
      if (gcItems.length > 0) {
        const cleaned = garbageCollect(content, gcItems);
        writeFileSync(CONFIG.observationsPath, cleaned, 'utf8');
        console.log(`Garbage collected ${gcItems.length} items from OBSERVATIONS.md`);
      }

      // 创建 inbox item
      createReflectorInboxItem(skills, axioms, gcItems, summary, draftFiles);
    }
  } catch (err) {
    console.error('Failed to analyze:', err.message);
    process.exit(1);
  }
}

main();
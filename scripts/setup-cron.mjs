#!/usr/bin/env node
/**
 * 设置定时任务
 *
 * 配置 Observer 和 Reflector 的定时执行
 *
 * 用法: node scripts/setup-cron.mjs
 */

import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const SCRIPTS_DIR = join(homedir(), 'Development', 'remotelab', 'scripts');

// 当前的 crontab
function getCurrentCrontab() {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

// 检查是否已有我们的任务
function hasOurJobs(crontab) {
  return crontab.includes('observer.mjs') || crontab.includes('reflector.mjs');
}

// 生成新的 crontab 内容
function generateCrontab(current) {
  // 移除旧的我们的任务
  const lines = current.split('\n').filter(line =>
    !line.includes('observer.mjs') && !line.includes('reflector.mjs')
  );

  // 添加新任务
  // Observer: 每天凌晨 2 点执行
  const observerJob = `0 2 * * * /usr/local/bin/node ${join(SCRIPTS_DIR, 'observer.mjs')} >> /tmp/observer.log 2>&1`;

  // Reflector: 每周日凌晨 3 点执行
  const reflectorJob = `0 3 * * 0 /usr/local/bin/node ${join(SCRIPTS_DIR, 'reflector.mjs')} >> /tmp/reflector.log 2>&1`;

  // 确保有一个空行在末尾
  const result = [...lines, observerJob, reflectorJob, ''].join('\n');

  return result;
}

function main() {
  console.log('Setting up cron jobs for Observer and Reflector...\n');

  const current = getCurrentCrontab();

  if (hasOurJobs(current)) {
    console.log('Found existing jobs, updating...');
  }

  const newCrontab = generateCrontab(current);

  console.log('New crontab:');
  console.log('---');
  console.log(newCrontab);
  console.log('---\n');

  // 应用新的 crontab
  try {
    execSync(`echo '${newCrontab}' | crontab -`);
    console.log('✅ Cron jobs installed successfully!');
    console.log('\nJobs:');
    console.log('  - Observer: 每天凌晨 2:00 执行');
    console.log('  - Reflector: 每周日凌晨 3:00 执行');
    console.log('\n日志位置:');
    console.log('  - /tmp/observer.log');
    console.log('  - /tmp/reflector.log');
  } catch (err) {
    console.error('❌ Failed to install cron jobs:', err.message);
    console.log('\n手动安装:');
    console.log('1. 运行 `crontab -e`');
    console.log('2. 添加以下行:');
    console.log(`   0 2 * * * /usr/local/bin/node ${join(SCRIPTS_DIR, 'observer.mjs')} >> /tmp/observer.log 2>&1`);
    console.log(`   0 3 * * 0 /usr/local/bin/node ${join(SCRIPTS_DIR, 'reflector.mjs')} >> /tmp/reflector.log 2>&1`);
  }
}

main();
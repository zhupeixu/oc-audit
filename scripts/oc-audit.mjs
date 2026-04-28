#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

// --- Config (env > defaults) ---
const HOME = homedir();
const AGENTS_DIR = process.env.OC_AUDIT_AGENTS_DIR || join(HOME, '.openclaw', 'agents');
const REPORTS_DIR = process.env.OC_AUDIT_REPORTS_DIR || join(HOME, '.openclaw', 'audit-reports');
const WEBHOOK_URL = process.env.OC_AUDIT_WEBHOOK || '';
const OC_CONFIG = join(HOME, '.openclaw', 'openclaw.json');

// LLM analysis config
const LLM_URL = process.env.OC_AUDIT_LLM_URL || '';
const LLM_KEY = process.env.OC_AUDIT_LLM_KEY || '';
const LLM_MODEL = process.env.OC_AUDIT_LLM_MODEL || 'claude-sonnet-4-20250514';

// Feishu doc config
const FEISHU_APP_ID = process.env.OC_AUDIT_FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.OC_AUDIT_FEISHU_APP_SECRET || '';
const LARK_PROFILE = process.env.OC_AUDIT_LARK_PROFILE || '';

// --- CLI ---
function usage() {
  console.log(`Usage:
  oc-audit daily [date] [end-date]   审计指定日期（默认昨天）
  oc-audit review                    全量历史 Review
  oc-audit analyze [days]            综合分析报告（量化+LLM，默认7天）

Environment:
  OC_AUDIT_WEBHOOK          飞书 Webhook URL（必须）
  OC_AUDIT_AGENTS_DIR       Agent 目录（默认 ~/.openclaw/agents/）
  OC_AUDIT_REPORTS_DIR      报告目录（默认 ~/.openclaw/audit-reports/）

  # analyze 模式需要:
  OC_AUDIT_LLM_URL          LLM API URL (Anthropic Messages API 兼容)
  OC_AUDIT_LLM_KEY          LLM API Key
  OC_AUDIT_LLM_MODEL        LLM 模型名（默认 claude-sonnet-4-20250514）

  # 飞书文档输出（可选）:
  OC_AUDIT_FEISHU_APP_ID    飞书应用 App ID
  OC_AUDIT_FEISHU_APP_SECRET 飞书应用 App Secret
  OC_AUDIT_LARK_PROFILE     lark-cli profile 名称`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) usage();

  const mode = ['review', 'daily', 'analyze'].includes(args[0]) ? args[0] : 'daily';
  const rest = (args[0] === mode) ? args.slice(1) : args;

  if (mode === 'review') return { mode };

  if (mode === 'analyze') {
    const days = parseInt(rest[0] || '7', 10);
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return { mode, days, startDate: cutoff, endDate: now };
  }

  const now = new Date();
  if (rest.length === 0) {
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    return { mode, startDate: startOfDay(yesterday), endDate: endOfDay(yesterday) };
  }
  if (rest.length === 1) {
    const d = new Date(rest[0] + 'T00:00:00');
    return { mode, startDate: startOfDay(d), endDate: endOfDay(d) };
  }
  return { mode, startDate: startOfDay(new Date(rest[0] + 'T00:00:00')), endDate: endOfDay(new Date(rest[1] + 'T00:00:00')) };
}

// --- Utility ---
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime(); }
function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime(); }
function formatMs(ms) {
  if (!ms || ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function formatNum(n) { return n.toLocaleString('en-US'); }
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function toolRate(s) {
  const t = s.toolResults.ok + s.toolResults.error;
  return t === 0 ? 'N/A' : ((s.toolResults.ok / t) * 100).toFixed(1) + '%';
}

// --- Auto-discover ---
function discoverAgentDirs() {
  if (!existsSync(AGENTS_DIR)) { console.error(`❌ Agent 目录不存在: ${AGENTS_DIR}`); process.exit(1); }
  return readdirSync(AGENTS_DIR).filter(d => {
    const sessDir = join(AGENTS_DIR, d, 'sessions');
    try { return existsSync(sessDir); } catch { return false; }
  });
}

function discoverAllAgentIds() {
  const fromDir = new Set(discoverAgentDirs());
  if (existsSync(OC_CONFIG)) {
    try {
      const config = JSON.parse(readFileSync(OC_CONFIG, 'utf-8'));
      for (const a of (config.agents?.list || [])) { if (a.id) fromDir.add(a.id); }
    } catch {}
  }
  return [...fromDir];
}

function getEmployeeName(agentId) {
  if (agentId === 'main') return 'Main';
  const ocDir = dirname(AGENTS_DIR);
  const userFile = join(ocDir, `workspace-${agentId}`, 'USER.md');
  if (!existsSync(userFile)) return agentId;
  const content = readFileSync(userFile, 'utf-8');
  const match = content.match(/\*\*Name:\*\*\s*(.+)/);
  if (!match) return agentId;
  const name = match[1].trim();
  if (!name || name.startsWith('-') || name.startsWith('*') || name.startsWith('_')) return agentId;
  return name;
}

// --- Session loading ---
function parseJSONL(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim()).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function extractSessionMeta(filePath) {
  const events = parseJSONL(filePath);
  if (events.length === 0) return null;
  let startedAt = null, endedAt = null;
  const sessionEvent = events.find(e => e.type === 'session');
  if (sessionEvent?.timestamp) startedAt = new Date(sessionEvent.timestamp).getTime();
  for (const e of events) {
    if (e.timestamp) {
      const t = new Date(e.timestamp).getTime();
      if (!startedAt || t < startedAt) startedAt = t;
      if (!endedAt || t > endedAt) endedAt = t;
    }
  }
  if (!startedAt) return null;
  return {
    sessionId: sessionEvent?.id || basename(filePath).split('.')[0],
    sessionFile: filePath, startedAt, endedAt,
    runtimeMs: (endedAt && startedAt) ? endedAt - startedAt : 0,
    status: 'reset', sessionKey: `reset:${basename(filePath)}`, isReset: true,
  };
}

function loadSessions(agentId, { startDate, endDate } = {}) {
  const sessionsDir = join(AGENTS_DIR, agentId, 'sessions');
  if (!existsSync(sessionsDir)) return [];

  const sessions = [];
  const knownFiles = new Set();
  const sessionsFile = join(sessionsDir, 'sessions.json');

  if (existsSync(sessionsFile)) {
    const data = JSON.parse(readFileSync(sessionsFile, 'utf-8'));
    for (const [key, session] of Object.entries(data)) {
      if (session.sessionFile) knownFiles.add(session.sessionFile);
      const s = { ...session, sessionKey: key };
      if (!s.runtimeMs && s.startedAt) s.runtimeMs = (s.endedAt || Date.now()) - s.startedAt;
      if (!s.status) s.status = 'unknown';
      if (startDate && endDate) {
        if (!s.startedAt || s.startedAt < startDate || s.startedAt > endDate) continue;
      }
      sessions.push(s);
    }
  }

  const files = readdirSync(sessionsDir);
  for (const file of files) {
    if (!file.includes('.jsonl.reset.') && !file.includes('.jsonl.deleted.')) continue;
    const fullPath = join(sessionsDir, file);
    if (knownFiles.has(fullPath)) continue;
    const meta = extractSessionMeta(fullPath);
    if (!meta) continue;
    if (startDate && endDate && (meta.startedAt < startDate || meta.startedAt > endDate)) continue;
    sessions.push(meta);
  }

  return sessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

// --- Analysis ---
function analyzeSession(events) {
  const stats = {
    userMessages: 0, assistantMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    toolCalls: {}, toolResults: { ok: 0, error: 0 }, toolDurations: {},
    toolErrors: [], errors: [], stopReasons: {},
  };

  for (const event of events) {
    if (event.type !== 'message') continue;
    const msg = event.message;
    if (!msg) continue;

    if (msg.role === 'user') {
      stats.userMessages++;
    } else if (msg.role === 'assistant') {
      stats.assistantMessages++;
      if (msg.usage) {
        stats.tokens.input += msg.usage.input || 0;
        stats.tokens.output += msg.usage.output || 0;
        stats.tokens.cacheRead += msg.usage.cacheRead || 0;
        stats.tokens.cacheWrite += msg.usage.cacheWrite || 0;
        stats.tokens.total += msg.usage.totalTokens || 0;
      }
      const reason = msg.stopReason || 'unknown';
      stats.stopReasons[reason] = (stats.stopReasons[reason] || 0) + 1;
      if (msg.stopReason === 'error' && msg.errorMessage) stats.errors.push(msg.errorMessage);
      for (const c of (msg.content || [])) {
        if (c.type === 'toolCall') stats.toolCalls[c.name || 'unknown'] = (stats.toolCalls[c.name || 'unknown'] || 0) + 1;
      }
    } else if (msg.role === 'toolResult') {
      if (msg.isError) {
        stats.toolResults.error++;
        const text = (msg.content || []).map(c => c.text || '').join('').slice(0, 200);
        if (text) stats.toolErrors.push({ tool: msg.toolName, error: text });
      } else {
        stats.toolResults.ok++;
      }
      if (msg.details?.durationMs) {
        const name = msg.toolName || 'unknown';
        if (!stats.toolDurations[name]) stats.toolDurations[name] = [];
        stats.toolDurations[name].push(msg.details.durationMs);
      }
    }
  }
  return stats;
}

function mergeStats(statsList) {
  const m = {
    userMessages: 0, assistantMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    toolCalls: {}, toolResults: { ok: 0, error: 0 }, toolDurations: {},
    toolErrors: [], errors: [], stopReasons: {},
  };
  for (const s of statsList) {
    m.userMessages += s.userMessages;
    m.assistantMessages += s.assistantMessages;
    for (const k of Object.keys(m.tokens)) m.tokens[k] += s.tokens[k];
    for (const [t, c] of Object.entries(s.toolCalls)) m.toolCalls[t] = (m.toolCalls[t] || 0) + c;
    m.toolResults.ok += s.toolResults.ok;
    m.toolResults.error += s.toolResults.error;
    for (const [t, ds] of Object.entries(s.toolDurations)) {
      if (!m.toolDurations[t]) m.toolDurations[t] = [];
      m.toolDurations[t].push(...ds);
    }
    m.toolErrors.push(...s.toolErrors);
    m.errors.push(...s.errors);
    for (const [r, c] of Object.entries(s.stopReasons)) m.stopReasons[r] = (m.stopReasons[r] || 0) + c;
  }
  return m;
}

// --- Conversation extraction for LLM ---
function extractConversation(events) {
  const turns = [];
  for (const event of events) {
    if (event.type !== 'message') continue;
    const msg = event.message;
    if (!msg) continue;
    if (msg.role === 'user') {
      const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text);
      const text = texts.join('\n').trim();
      if (text && !text.startsWith('Conversation info') && !text.startsWith('<system')) {
        turns.push({ role: 'user', text: text.slice(0, 500) });
      }
    } else if (msg.role === 'assistant') {
      const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text);
      const toolCalls = (msg.content || []).filter(c => c.type === 'toolCall').map(c => c.name);
      let summary = '';
      const text = texts.join('\n').trim();
      if (text) summary += text.slice(0, 300);
      if (toolCalls.length > 0) summary += (summary ? ' ' : '') + `[工具: ${toolCalls.join(', ')}]`;
      if (summary) turns.push({ role: 'assistant', text: summary });
    }
  }
  return turns;
}

// --- Daily Report ---
function generateDailyReport(agentReports, startDate, endDate) {
  const dateLabel = fmtDate(startDate) === fmtDate(endDate) ? fmtDate(startDate) : `${fmtDate(startDate)} ~ ${fmtDate(endDate)}`;
  const globalStats = mergeStats(agentReports.flatMap(a => a.stats));
  const totalSessions = agentReports.reduce((s, a) => s + a.sessions.length, 0);
  const totalRuntime = agentReports.reduce((s, a) => s + a.sessions.reduce((ss, sess) => ss + (sess.runtimeMs || 0), 0), 0);
  const activeAgents = agentReports.filter(a => a.sessions.length > 0);
  const statusCounts = {};
  for (const a of agentReports) for (const s of a.sessions) statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;

  let md = `# OpenClaw 日志审计报告\n**日期**: ${dateLabel}\n**生成时间**: ${fmtDateTime(Date.now())}\n\n`;
  md += `---\n\n## 全局概览\n\n| 指标 | 数值 |\n|------|------|\n`;
  md += `| 活跃 Agent | ${activeAgents.length} / ${agentReports.length} |\n`;
  md += `| 总会话数 | ${totalSessions} |\n`;
  md += `| 会话状态 | ${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ')} |\n`;
  md += `| 运行时长 | ${formatMs(totalRuntime)} |\n`;
  md += `| Token 消耗 | ${formatNum(globalStats.tokens.total)} (in: ${formatNum(globalStats.tokens.input)}, out: ${formatNum(globalStats.tokens.output)}) |\n`;
  md += `| 工具调用 | ${globalStats.toolResults.ok + globalStats.toolResults.error} 次 | 成功率 ${toolRate(globalStats)} |\n`;
  md += `| 错误数 | ${globalStats.errors.length} |\n\n`;

  const ranked = activeAgents.map(a => ({ ...a, merged: mergeStats(a.stats), runtime: a.sessions.reduce((s, ss) => s + (ss.runtimeMs || 0), 0) }))
    .sort((a, b) => b.merged.tokens.total - a.merged.tokens.total);

  if (ranked.length > 0) {
    md += `## Agent 详情\n\n`;
    for (const a of ranked) {
      const s = a.merged;
      const toolTotal = s.toolResults.ok + s.toolResults.error;
      const topTools = Object.entries(s.toolCalls).sort((x, y) => y[1] - x[1]).slice(0, 5);
      md += `### ${a.name} (${a.agentId})\n`;
      md += `> ${a.sessions.length} 会话 | ${formatMs(a.runtime)} | ${formatNum(s.tokens.total)} Token | 工具 ${toolTotal} 次 (${toolRate(s)})\n\n`;
      if (topTools.length > 0) md += `- Top 工具: ${topTools.map(([n, c]) => `${n}(${c})`).join(', ')}\n`;
      if (s.errors.length > 0) md += `- 错误: ${s.errors.length} 次\n`;
      md += `\n`;
    }
  }

  const inactiveAgents = agentReports.filter(a => a.sessions.length === 0);
  if (inactiveAgents.length > 0) md += `**无活动**: ${inactiveAgents.map(a => a.agentId).join(', ')}\n\n`;

  const alerts = [];
  for (const a of ranked) {
    const s = a.merged;
    const toolTotal = s.toolResults.ok + s.toolResults.error;
    if (toolTotal >= 5 && s.toolResults.error / toolTotal > 0.1) alerts.push(`⚠️ **${a.name}**: 工具错误率 ${((s.toolResults.error / toolTotal) * 100).toFixed(1)}%`);
    if (s.errors.some(e => e.includes('401') || e.includes('无效的令牌'))) alerts.push(`🔑 **${a.name}**: 认证错误`);
    for (const ss of a.sessions) {
      if (ss.status === 'timeout') alerts.push(`⏱️ **${a.name}**: 会话超时 (${formatMs(ss.runtimeMs)})`);
    }
  }
  if (alerts.length > 0) { md += `## 异常告警\n\n${alerts.map(a => `- ${a}`).join('\n')}\n\n`; }

  md += `---\n*报告由 oc-audit 自动生成*\n`;
  return { md, dateLabel };
}

// --- Analyze Report (quantitative section) ---
function generateAnalyzeQuantReport(agentReports, startDate, endDate) {
  const periodLabel = `${fmtDate(startDate)} ~ ${fmtDate(endDate)}`;
  const globalStats = mergeStats(agentReports.flatMap(a => a.sessionStats));
  const totalSessions = agentReports.reduce((sum, a) => sum + a.sessions.length, 0);
  const totalRuntime = agentReports.reduce((sum, a) => sum + a.sessions.reduce((s, sess) => s + (sess.runtimeMs || 0), 0), 0);
  const activeAgents = agentReports.filter(a => a.sessions.length > 0);

  const statusCounts = {};
  for (const a of agentReports) {
    for (const sess of a.sessions) {
      statusCounts[sess.status || 'unknown'] = (statusCounts[sess.status || 'unknown'] || 0) + 1;
    }
  }

  let md = `## 一、数据概览\n\n`;
  md += `| 指标 | 数值 |\n|------|------|\n`;
  md += `| 统计周期 | ${periodLabel} |\n`;
  md += `| 活跃 Agent | ${activeAgents.length} / ${agentReports.length} |\n`;
  md += `| 总会话数 | ${totalSessions} |\n`;
  md += `| 会话状态 | ${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ')} |\n`;
  md += `| 总运行时长 | ${formatMs(totalRuntime)} |\n`;
  md += `| Token 消耗 | ${formatNum(globalStats.tokens.total)} |\n`;
  md += `| ├ Input | ${formatNum(globalStats.tokens.input)} |\n`;
  md += `| ├ Output | ${formatNum(globalStats.tokens.output)} |\n`;
  md += `| ├ Cache Read | ${formatNum(globalStats.tokens.cacheRead)} |\n`;
  md += `| └ Cache Write | ${formatNum(globalStats.tokens.cacheWrite)} |\n`;
  md += `| 用户消息 | ${globalStats.userMessages} |\n`;
  md += `| 助手回复 | ${globalStats.assistantMessages} |\n`;
  md += `| 工具调用 | ${globalStats.toolResults.ok + globalStats.toolResults.error} 次 |\n`;
  md += `| 工具成功率 | ${toolRate(globalStats)} |\n`;
  md += `| 错误总数 | ${globalStats.errors.length} |\n`;

  const ranked = [...activeAgents].sort((a, b) => {
    const ta = mergeStats(a.sessionStats).tokens.total;
    const tb = mergeStats(b.sessionStats).tokens.total;
    return tb - ta;
  });

  md += `\n## 二、Agent 排名\n\n`;
  md += `| 排名 | 员工 | 会话数 | Token | 运行时长 | 工具调用 | 成功率 | 错误 |\n`;
  md += `|------|------|--------|-------|----------|---------|--------|------|\n`;
  ranked.forEach((a, i) => {
    const s = mergeStats(a.sessionStats);
    const rt = a.sessions.reduce((sum, sess) => sum + (sess.runtimeMs || 0), 0);
    const toolTotal = s.toolResults.ok + s.toolResults.error;
    md += `| ${i + 1} | ${a.name} | ${a.sessions.length} | ${formatNum(s.tokens.total)} | ${formatMs(rt)} | ${toolTotal} | ${toolRate(s)} | ${s.errors.length} |\n`;
  });

  md += `\n## 三、Agent 详情\n\n`;
  for (const a of ranked) {
    const s = mergeStats(a.sessionStats);
    const rt = a.sessions.reduce((sum, sess) => sum + (sess.runtimeMs || 0), 0);
    const toolTotal = s.toolResults.ok + s.toolResults.error;

    md += `### ${a.name} (${a.agentId})\n\n`;
    md += `- **会话**: ${a.sessions.length} | **时长**: ${formatMs(rt)} | **Token**: ${formatNum(s.tokens.total)} (in: ${formatNum(s.tokens.input)}, out: ${formatNum(s.tokens.output)})\n`;
    md += `- **消息**: 用户 ${s.userMessages} / 助手 ${s.assistantMessages} | **平均 Token/轮**: ${s.assistantMessages > 0 ? formatNum(Math.round(s.tokens.total / s.assistantMessages)) : 'N/A'}\n`;
    md += `- **工具**: ${toolTotal} 次 (成功 ${s.toolResults.ok}, 失败 ${s.toolResults.error}) | 成功率 ${toolRate(s)}\n`;

    const sortedTools = Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]);
    if (sortedTools.length > 0) md += `- **Top 工具**: ${sortedTools.slice(0, 8).map(([n, c]) => `${n}(${c})`).join(', ')}\n`;

    if (Object.keys(s.toolDurations).length > 0) {
      const avgDurations = Object.entries(s.toolDurations)
        .map(([name, durations]) => ({ name, avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) }))
        .sort((a, b) => b.avg - a.avg);
      md += `- **工具耗时**: ${avgDurations.slice(0, 5).map(d => `${d.name}(${formatMs(d.avg)})`).join(', ')}\n`;
    }

    const statusDist = {};
    for (const sess of a.sessions) statusDist[sess.status || 'unknown'] = (statusDist[sess.status || 'unknown'] || 0) + 1;
    md += `- **状态分布**: ${Object.entries(statusDist).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;

    if (s.errors.length > 0) {
      md += `- **错误** (${s.errors.length}):\n`;
      const uniqueErrors = [...new Set(s.errors.map(e => e.slice(0, 150)))];
      for (const err of uniqueErrors.slice(0, 3)) md += `  - \`${err}\`\n`;
      if (uniqueErrors.length > 3) md += `  - ... 还有 ${uniqueErrors.length - 3} 个\n`;
    }
    md += `\n`;
  }

  md += `## 四、工具使用排行\n\n`;
  const allTools = Object.entries(globalStats.toolCalls).sort((a, b) => b[1] - a[1]);
  if (allTools.length > 0) {
    md += `| 排名 | 工具 | 调用次数 | 占比 |\n|------|------|----------|------|\n`;
    const toolTotalCalls = allTools.reduce((s, [, c]) => s + c, 0);
    allTools.forEach(([name, count], i) => {
      md += `| ${i + 1} | ${name} | ${count} | ${((count / toolTotalCalls) * 100).toFixed(1)}% |\n`;
    });
  }

  md += `\n## 五、异常告警\n\n`;
  const alerts = [];
  for (const a of ranked) {
    const s = mergeStats(a.sessionStats);
    const toolTotal = s.toolResults.ok + s.toolResults.error;
    const errorRate = toolTotal > 0 ? s.toolResults.error / toolTotal : 0;
    if (errorRate > 0.1 && toolTotal >= 5) alerts.push(`**${a.name}**: 工具错误率 ${(errorRate * 100).toFixed(1)}%`);
    if (s.errors.some(e => e.includes('401') || e.includes('Unauthorized'))) alerts.push(`**${a.name}**: 存在认证错误`);
    if (s.tokens.total > 500000) alerts.push(`**${a.name}**: Token 消耗 ${formatNum(s.tokens.total)}`);
    for (const sess of a.sessions) {
      if (sess.status === 'failed') alerts.push(`**${a.name}**: 会话 failed`);
      if (sess.status === 'timeout') alerts.push(`**${a.name}**: 会话超时 (${formatMs(sess.runtimeMs)})`);
    }
  }
  md += alerts.length > 0 ? alerts.map(a => `- ${a}`).join('\n') + '\n' : '无异常\n';

  return md;
}

// --- Review Report ---
function gradeAgent(a, s) {
  let score = 0;
  const tRate = (s.toolResults.ok + s.toolResults.error) > 0 ? s.toolResults.ok / (s.toolResults.ok + s.toolResults.error) : 1;
  const failedTimeout = a.sessions.filter(ss => ss.status === 'failed' || ss.status === 'timeout').length;
  const healthRate = a.sessions.length > 0 ? 1 - failedTimeout / a.sessions.length : 1;
  const days = new Set(a.sessions.map(ss => fmtDate(ss.startedAt))).size;

  if (a.sessions.length >= 8) score += 3; else if (a.sessions.length >= 4) score += 2; else if (a.sessions.length >= 1) score += 1;
  if (days >= 5) score += 2; else if (days >= 3) score += 1;
  if (tRate >= 0.95) score += 3; else if (tRate >= 0.85) score += 2; else if (tRate >= 0.70) score += 1;
  if (healthRate >= 0.8) score += 2; else if (healthRate >= 0.5) score += 1;

  if (score >= 9) return { grade: 'A', label: '优秀' };
  if (score >= 7) return { grade: 'B', label: '良好' };
  if (score >= 4) return { grade: 'C', label: '一般' };
  return { grade: 'D', label: '需改进' };
}

function generateReviewReport(agentData, allAgentIds) {
  const allStats = mergeStats(agentData.flatMap(a => a.stats));
  const totalSessions = agentData.reduce((s, a) => s + a.sessions.length, 0);
  const totalRuntime = agentData.reduce((s, a) => s + a.sessions.reduce((ss, sess) => ss + (sess.runtimeMs || 0), 0), 0);
  const activeAgents = agentData.filter(a => a.sessions.length > 0);
  const inactiveIds = allAgentIds.filter(id => !activeAgents.find(a => a.agentId === id));
  const allSessions = agentData.flatMap(a => a.sessions);
  const earliest = allSessions.length > 0 ? Math.min(...allSessions.map(s => s.startedAt || Infinity)) : 0;
  const latest = allSessions.length > 0 ? Math.max(...allSessions.map(s => s.startedAt || 0)) : 0;

  const ranked = activeAgents.map(a => {
    const s = mergeStats(a.stats);
    const rt = a.sessions.reduce((sum, ss) => sum + (ss.runtimeMs || 0), 0);
    return { ...a, merged: s, runtime: rt, toolTotal: s.toolResults.ok + s.toolResults.error, ...gradeAgent(a, s) };
  }).sort((a, b) => b.sessions.length - a.sessions.length);

  let md = `# OpenClaw AI Agent 使用 Review\n\n`;
  md += `> 统计周期: ${fmtDate(earliest)} ~ ${fmtDate(latest)} | 生成于 ${fmtDateTime(Date.now())}\n\n`;

  md += `## 一、团队总览\n\n`;
  md += `| | 数据 |\n|---|---|\n`;
  md += `| 团队规模 | ${allAgentIds.length} 人已分配 Agent |\n`;
  md += `| 实际使用 | **${activeAgents.length} 人使用** / ${inactiveIds.length} 人未使用 |\n`;
  md += `| 采纳率 | **${((activeAgents.length / allAgentIds.length) * 100).toFixed(0)}%** |\n`;
  md += `| 总对话轮次 | ${allStats.userMessages} 轮 |\n`;
  md += `| 总使用时长 | ${formatMs(totalRuntime)} |\n`;
  md += `| Token 消耗 | ${formatNum(allStats.tokens.total)} |\n`;
  md += `| 工具调用成功率 | ${toolRate(allStats)} |\n`;

  md += `\n### 团队计分板\n\n`;
  md += `| 员工 | 评级 | 会话数 | 活跃天数 | 使用时长 | 工具成功率 | 对话轮次 |\n`;
  md += `|------|------|--------|----------|----------|-----------|----------|\n`;
  for (const a of ranked) {
    const days = new Set(a.sessions.map(ss => fmtDate(ss.startedAt))).size;
    md += `| ${a.name} | **${a.grade}** (${a.label}) | ${a.sessions.length} | ${days} | ${formatMs(a.runtime)} | ${toolRate(a.merged)} | ${a.merged.userMessages} |\n`;
  }
  for (const id of inactiveIds) md += `| ${getEmployeeName(id)} | **-** (未使用) | 0 | 0 | - | - | 0 |\n`;

  md += `\n---\n\n## 二、员工 Review Card\n\n`;
  for (const a of ranked) {
    const s = a.merged;
    const days = new Set(a.sessions.map(ss => fmtDate(ss.startedAt))).size;
    const failedTimeout = a.sessions.filter(ss => ss.status === 'failed' || ss.status === 'timeout').length;
    const topTools = Object.entries(s.toolCalls).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const cacheRate = (s.tokens.cacheRead + s.tokens.input) > 0 ? s.tokens.cacheRead / (s.tokens.cacheRead + s.tokens.input) : 0;

    md += `### ${a.name} — 评级 ${a.grade} (${a.label})\n\n`;
    md += `> ${a.sessions.length} 个会话 | ${days} 天活跃 | ${formatMs(a.runtime)} 使用时长 | ${formatNum(s.tokens.total)} Token | 工具成功率 ${toolRate(s)}\n\n`;

    const strengths = [];
    if (a.sessions.length >= 8) strengths.push('使用频率高，已形成使用习惯');
    else if (a.sessions.length >= 4) strengths.push('有一定使用量');
    if (parseFloat(toolRate(s)) >= 95) strengths.push('工具使用精准，几乎无错误');
    else if (parseFloat(toolRate(s)) >= 90) strengths.push('工具使用质量良好');
    if (s.userMessages >= 20) strengths.push('交互深入，善于与 Agent 多轮协作');
    if (days >= 5) strengths.push('持续使用，跨越多天');
    if (topTools.length >= 4) strengths.push(`工具使用多样化 (${topTools.map(([n]) => n).join(', ')})`);
    if (cacheRate > 0.7) strengths.push(`Cache 命中率高 (${(cacheRate * 100).toFixed(0)}%)`);

    if (strengths.length > 0) { md += `**亮点**\n`; strengths.forEach(p => md += `- ${p}\n`); }

    const issues = [];
    if (failedTimeout > 0) issues.push(`${failedTimeout}/${a.sessions.length} 个会话异常 (${a.sessions.filter(ss => ss.status === 'timeout').length} 超时, ${a.sessions.filter(ss => ss.status === 'failed').length} 失败)`);
    if (s.toolErrors.length > 0) {
      const g = {}; s.toolErrors.forEach(e => g[e.tool] = (g[e.tool] || 0) + 1);
      const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
      issues.push(`工具错误 ${s.toolErrors.length} 次，主要集中在 ${top[0]} (${top[1]} 次)`);
    }
    if (s.errors.length > 0) {
      const types = [];
      if (s.errors.some(e => e.includes('401'))) types.push('认证失效');
      if (s.errors.some(e => e.includes('503'))) types.push('服务端无可用账户');
      if (s.errors.some(e => e.includes('429'))) types.push('日配额超限');
      if (types.length > 0) issues.push(`API 错误 ${s.errors.length} 次 (${types.join('、')}) — 平台侧问题`);
    }
    if (a.sessions.length <= 2 && days <= 1) issues.push('使用次数过少，尚未充分探索 Agent 能力');

    if (issues.length > 0) { md += `\n**待改进**\n`; issues.forEach(p => md += `- ${p}\n`); }

    md += `\n**Review 谈话要点**\n`;
    if (strengths.length > 0) md += `- 肯定: ${strengths[0]}\n`;
    if (failedTimeout > 0 && failedTimeout / a.sessions.length > 0.3) md += `- 探讨: 超时/失败的会话是在做什么任务？是否任务拆分可以避免？\n`;
    if (s.toolErrors.length > 10) md += `- 沟通: Agent 的工具调用错误较多，我们会优化提示词\n`;
    if (s.userMessages >= 20) md += `- 了解: 目前主要用 Agent 做哪些工作？有哪些场景觉得好用？\n`;
    if (a.sessions.length <= 3) md += `- 了解: 使用频率不高，是否遇到了阻碍？\n`;
    md += `- 展望: 接下来希望 Agent 帮你做哪些事情？\n\n`;
  }

  if (inactiveIds.length > 0) {
    md += `---\n\n### 未使用员工 (${inactiveIds.length} 人)\n\n`;
    md += `| 员工 | Agent ID |\n|------|----------|\n`;
    inactiveIds.forEach(id => md += `| ${getEmployeeName(id)} | ${id} |\n`);
    md += `\n**Review 谈话要点**\n`;
    md += `- 了解: 是否知道自己有 AI Agent？是否尝试过？\n`;
    md += `- 排障: 是否遇到了登录/权限/使用上的障碍？\n`;
    md += `- 引导: 演示一个具体的使用场景，让他们看到价值\n`;
    md += `- 跟进: 约定一个时间节点，再次检查使用情况\n`;
  }

  md += `\n---\n\n## 三、Review Session 建议议程\n\n`;
  md += `**每人 Review 流程 (15-20 min)**\n`;
  md += `1. **开场** (2 min): 说明目的——了解体验、发现问题、提升效率\n`;
  md += `2. **数据回顾** (3 min): 展示 Review Card，先肯定亮点\n`;
  md += `3. **问题探讨** (5 min): 讨论待改进项，区分「用户问题」和「平台问题」\n`;
  md += `4. **需求收集** (5 min): 希望 Agent 做什么、缺什么能力\n`;
  md += `5. **行动计划** (3 min): 约定改进目标和下次 check-in 时间\n\n`;
  md += `**会后跟进**: 汇总反馈、修复平台问题、安排未使用员工 onboarding、两周后跑对比报告\n`;

  md += `\n---\n*报告由 oc-audit 自动生成*\n`;
  return md;
}

// --- LLM API call ---
async function callLLM(prompt, content) {
  if (!LLM_URL || !LLM_KEY) throw new Error('未配置 OC_AUDIT_LLM_URL / OC_AUDIT_LLM_KEY');
  const payload = {
    model: LLM_MODEL, max_tokens: 8192,
    messages: [{ role: 'user', content: `${prompt}\n\n---\n\n${content}` }]
  };
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(new URL(LLM_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LLM_KEY, 'anthropic-version': '2023-06-01' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body).content?.map(c => c.text).join('') || ''); }
          catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        } else reject(new Error(`API ${res.statusCode}: ${body.slice(0, 500)}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Feishu doc creation ---
function httpJSON(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const parsed = new URL(url);
    const req = https.request(parsed, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    }); req.on('error', reject); if (data) req.write(data); req.end();
  });
}

async function setDocPublic(docToken) {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) return;
  const tokenRes = await httpJSON('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', 'POST', {}, {
    app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET
  });
  const token = tokenRes.tenant_access_token;
  if (!token) throw new Error('获取 tenant_access_token 失败');

  const res = await httpJSON(`https://open.feishu.cn/open-apis/drive/v1/permissions/${docToken}/public?type=docx`, 'PATCH',
    { Authorization: `Bearer ${token}` },
    { external_access_entity: 'open', security_entity: 'anyone_can_view', comment_entity: 'anyone_can_view', share_entity: 'anyone', link_share_entity: 'anyone_readable' }
  );
  if (res.code !== 0) console.error(`  ⚠️ 设置公开权限失败: ${res.msg}`);
}

async function createFeishuDoc(title, reportFile) {
  if (!LARK_PROFILE) throw new Error('未配置 OC_AUDIT_LARK_PROFILE');
  const cmd = `LARK_CLI_PROFILE=${LARK_PROFILE} lark-cli docs +create --title "${title}" --markdown - --as bot`;
  const mdContent = readFileSync(reportFile, 'utf-8');
  const output = execSync(cmd, { input: mdContent, encoding: 'utf-8', timeout: 60000 });
  const result = JSON.parse(output);
  if (!result.ok) throw new Error(result.data?.message || 'lark-cli 创建文档失败');
  const docId = result.data.doc_id;
  const docUrl = result.data.doc_url;
  await setDocPublic(docId);
  return { docId, docUrl };
}

// --- Feishu Webhook ---
function buildCard(md, title) {
  const truncated = md.length > 28000 ? md.slice(0, 27500) + '\n\n... (报告过长已截断)' : md;
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
      elements: [{ tag: 'markdown', content: truncated }]
    }
  };
}

async function sendWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(body) : reject(new Error(`${res.statusCode}: ${body}`)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Main ---
async function main() {
  const opts = parseArgs();

  if (opts.mode === 'daily') {
    const dateLabel = fmtDate(opts.startDate) === fmtDate(opts.endDate) ? fmtDate(opts.startDate) : `${fmtDate(opts.startDate)} ~ ${fmtDate(opts.endDate)}`;
    console.log(`🔍 审计日期: ${dateLabel}`);

    const agentDirs = discoverAgentDirs();
    console.log(`📂 发现 ${agentDirs.length} 个 agent: ${agentDirs.join(', ')}`);

    const agentReports = agentDirs.map(agentId => {
      const sessions = loadSessions(agentId, opts);
      const stats = sessions.map(s => s.sessionFile ? analyzeSession(parseJSONL(s.sessionFile)) : analyzeSession([]));
      return { agentId, name: getEmployeeName(agentId), sessions, stats };
    });

    const totalSessions = agentReports.reduce((s, a) => s + a.sessions.length, 0);
    console.log(`📊 筛选到 ${totalSessions} 个会话\n`);

    if (totalSessions === 0) { console.log(`ℹ️  ${dateLabel} 无任何会话记录`); return; }

    const { md } = generateDailyReport(agentReports, opts.startDate, opts.endDate);
    mkdirSync(REPORTS_DIR, { recursive: true });
    const file = join(REPORTS_DIR, `${dateLabel.replace(/[~\s]/g, '_')}.md`);
    writeFileSync(file, md, 'utf-8');
    console.log(`💾 报告已保存: ${file}`);

    if (WEBHOOK_URL) {
      try { await sendWebhook(WEBHOOK_URL, buildCard(md, `📋 OpenClaw 日报 - ${dateLabel}`)); console.log('✅ 已推送到飞书'); }
      catch (e) { console.error(`❌ 飞书推送失败: ${e.message}`); }
    } else { console.log('ℹ️  未设置 OC_AUDIT_WEBHOOK，跳过飞书推送'); }

    console.log('\n' + md);

  } else if (opts.mode === 'review') {
    console.log('🔍 正在分析全量历史数据...\n');

    const allAgentIds = discoverAllAgentIds();
    const agentDirs = discoverAgentDirs();

    const agentData = agentDirs.map(agentId => {
      const sessions = loadSessions(agentId);
      const stats = sessions.map(s => s.sessionFile ? analyzeSession(parseJSONL(s.sessionFile)) : analyzeSession([]));
      const name = getEmployeeName(agentId);
      if (sessions.length > 0) console.log(`  📂 ${agentId} (${name}): ${sessions.length} 个会话`);
      return { agentId, name, sessions, stats };
    });

    const totalSessions = agentData.reduce((s, a) => s + a.sessions.length, 0);
    console.log(`\n📊 总计 ${totalSessions} 个会话\n`);

    const md = generateReviewReport(agentData, allAgentIds);
    mkdirSync(REPORTS_DIR, { recursive: true });
    const file = join(REPORTS_DIR, `full-review-${fmtDate(Date.now())}.md`);
    writeFileSync(file, md, 'utf-8');
    console.log(`💾 报告已保存: ${file}`);

    if (WEBHOOK_URL) {
      try { await sendWebhook(WEBHOOK_URL, buildCard(md, 'OpenClaw AI Agent 使用 Review')); console.log('✅ 已推送到飞书'); }
      catch (e) { console.error(`❌ 飞书推送失败: ${e.message}`); }
    } else { console.log('ℹ️  未设置 OC_AUDIT_WEBHOOK，跳过飞书推送'); }

    console.log('\n' + md);

  } else if (opts.mode === 'analyze') {
    const days = opts.days;
    const label = days === 7 ? '周报' : days === 30 ? '月报' : `${days}天报告`;
    console.log(`🔍 正在生成 Agent 使用${label} (${fmtDate(opts.startDate)} ~ ${fmtDate(opts.endDate)})...\n`);

    const agentDirs = discoverAgentDirs();
    const agentReports = [];
    let allConversations = '';
    let convSessionCount = 0;

    for (const agentId of agentDirs) {
      const sessions = loadSessions(agentId, opts);
      const name = getEmployeeName(agentId);
      const sessionStats = [];

      for (const session of sessions) {
        if (!session.sessionFile) { sessionStats.push(analyzeSession([])); continue; }
        const events = parseJSONL(session.sessionFile);
        sessionStats.push(analyzeSession(events));

        const turns = extractConversation(events);
        if (turns.length > 0) {
          let text = `\n=== 员工: ${name} (${agentId}) ===\n`;
          text += `时间: ${fmtDateTime(session.startedAt)}\n`;
          text += `对话轮次: ${turns.filter(t => t.role === 'user').length} 轮\n\n`;
          for (const turn of turns) {
            text += turn.role === 'user' ? `[用户]: ${turn.text}\n` : `[Agent]: ${turn.text}\n`;
          }
          allConversations += text;
          convSessionCount++;
        }
      }

      if (sessions.length > 0) console.log(`  📂 ${name} (${agentId}): ${sessions.length} 个会话`);
      agentReports.push({ agentId, name, sessions, sessionStats });
    }

    const totalSessions = agentReports.reduce((s, a) => s + a.sessions.length, 0);
    console.log(`\n📊 共 ${totalSessions} 个会话, ${convSessionCount} 个有对话内容\n`);

    if (totalSessions === 0) {
      console.log(`ℹ️  ${fmtDate(opts.startDate)} ~ ${fmtDate(opts.endDate)} 无会话数据`);
      return;
    }

    console.log('📈 生成量化指标...');
    const quantMd = generateAnalyzeQuantReport(agentReports, opts.startDate, opts.endDate);

    let analysisMd = '';
    if (convSessionCount > 0 && LLM_URL && LLM_KEY) {
      console.log('🤖 调用 LLM 分析对话内容...\n');
      const prompt = `你是一个 AI Agent 使用分析师。请对以下员工与 AI Agent 的对话记录进行深度分析。

分析维度：
1. **使用场景** — 员工用 Agent 做什么工作？具体任务是什么？
2. **任务完成度** — 任务是否顺利完成？有没有中途放弃或反复修改？
3. **使用模式** — 简单问答还是深度协作？prompt 质量如何？
4. **痛点与需求** — 使用障碍、不满、隐含的功能需求
5. **改进建议** — 针对员工和平台的建议

输出中文 Markdown。先总体洞察，再按员工分析，最后整体建议。不要输出一级标题（#），从二级标题（##）开始。`;

      try {
        analysisMd = await callLLM(prompt, allConversations);
      } catch (e) {
        console.error(`⚠️ LLM 分析失败: ${e.message}`);
        analysisMd = `> LLM 分析失败: ${e.message}\n`;
      }
    } else if (convSessionCount > 0 && (!LLM_URL || !LLM_KEY)) {
      console.log('ℹ️  未配置 OC_AUDIT_LLM_URL / OC_AUDIT_LLM_KEY，跳过 LLM 深度分析');
    }

    const title = `OpenClaw Agent ${label} ${fmtDate(opts.startDate)}~${fmtDate(opts.endDate)}`;
    let fullReport = `# ${title}\n\n`;
    fullReport += `> 生成于 ${fmtDateTime(Date.now())}`;
    if (LLM_URL && LLM_KEY) fullReport += ` | 分析模型: ${LLM_MODEL}`;
    fullReport += `\n\n`;
    fullReport += quantMd;
    if (analysisMd) {
      fullReport += `\n---\n\n## 六、使用深度分析\n\n${analysisMd}\n`;
    }
    fullReport += `\n---\n*报告由 oc-audit 自动生成*\n`;

    mkdirSync(REPORTS_DIR, { recursive: true });
    const reportFile = join(REPORTS_DIR, `${label}-${fmtDate(opts.endDate)}.md`);
    writeFileSync(reportFile, fullReport, 'utf-8');
    console.log(`\n💾 本地报告: ${reportFile}`);

    // Feishu doc creation (optional)
    let docUrl = null;
    if (LARK_PROFILE) {
      try {
        console.log('📄 创建飞书文档...');
        const result = await createFeishuDoc(title, reportFile);
        docUrl = result.docUrl;
        console.log(`✅ 飞书文档: ${docUrl}`);
      } catch (e) {
        console.error(`⚠️ 飞书文档创建失败: ${e.message}`);
      }
    }

    // Webhook notification
    if (WEBHOOK_URL) {
      if (docUrl) {
        const globalStats = mergeStats(agentReports.flatMap(a => a.sessionStats));
        const card = {
          msg_type: 'interactive',
          card: {
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: `📊 ${title}` }, template: 'blue' },
            elements: [
              { tag: 'markdown', content: `**${label}已生成**\n\n📄 [点击查看完整报告](${docUrl})\n\n**快速摘要:**\n- 活跃 Agent: ${agentReports.filter(a => a.sessions.length > 0).length}\n- 总会话: ${totalSessions}\n- Token: ${formatNum(globalStats.tokens.total)}` },
              { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看报告' }, url: docUrl, type: 'primary' }] }
            ]
          }
        };
        try { await sendWebhook(WEBHOOK_URL, card); console.log('✅ Webhook 通知已发送'); }
        catch (e) { console.error(`❌ Webhook 发送失败: ${e.message}`); }
      } else {
        // Fallback: send content via webhook in chunks
        console.log('📤 通过 webhook 发送报告内容...');
        const chunks = [];
        for (let i = 0; i < fullReport.length; i += 25000) {
          chunks.push(fullReport.slice(i, i + 25000));
        }
        for (let idx = 0; idx < chunks.length; idx++) {
          const card = {
            msg_type: 'interactive',
            card: {
              config: { wide_screen_mode: true },
              header: { title: { tag: 'plain_text', content: chunks.length > 1 ? `${title} (${idx+1}/${chunks.length})` : title }, template: 'blue' },
              elements: [{ tag: 'markdown', content: chunks[idx] }]
            }
          };
          try { await sendWebhook(WEBHOOK_URL, card); } catch (we) { console.error(`  ❌ 第 ${idx+1} 条发送失败: ${we.message}`); }
        }
        console.log(`✅ 已通过 webhook 发送 ${chunks.length} 条消息`);
      }
    } else {
      console.log('ℹ️  未设置 OC_AUDIT_WEBHOOK，跳过飞书推送');
    }

    console.log('\n' + fullReport);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

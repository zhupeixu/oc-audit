---
name: oc-audit
description: "OpenClaw 多 Agent 日志审计与使用分析。审计各 Agent 的 token 消耗、工具调用、错误情况，生成报告并推送飞书 Webhook。支持日报、全量 Review、综合分析（量化+LLM深度分析）三种模式，可输出飞书文档。当用户提到审计、audit、日志审查、Agent 使用分析、review session、使用报告、周报、月报时触发。"
metadata:
  openclaw:
    emoji: "📋"
    requires:
      env: ["OC_AUDIT_WEBHOOK"]
    primaryEnv: "OC_AUDIT_WEBHOOK"
---

# OC Audit — OpenClaw 日志审计

## 首次使用

检查环境变量 `OC_AUDIT_WEBHOOK`。如果未设置，引导用户完成配置：

> 参考 [setup-guide.md](references/setup-guide.md)

配置完成后继续执行。

## 模式

根据用户意图选择模式：

| 用户说的 | 模式 | 命令 |
|---------|------|------|
| "审计昨天" / "日报" / 无特殊说明 | 日报 | `node <skill-dir>/scripts/oc-audit.mjs daily` |
| "审计 2026-04-21" | 指定日期 | `node <skill-dir>/scripts/oc-audit.mjs daily 2026-04-21` |
| "审计 4.1 到 4.21" | 日期范围 | `node <skill-dir>/scripts/oc-audit.mjs daily 2026-04-01 2026-04-21` |
| "全量审计" / "review" / "review session" | 全量 Review | `node <skill-dir>/scripts/oc-audit.mjs review` |
| "周报" / "最近7天分析" | 综合周报 | `node <skill-dir>/scripts/oc-audit.mjs analyze 7` |
| "月报" / "最近30天分析" | 综合月报 | `node <skill-dir>/scripts/oc-audit.mjs analyze 30` |
| "最近N天分析" | N天分析 | `node <skill-dir>/scripts/oc-audit.mjs analyze N` |

## 执行

运行脚本时传入环境变量：

```bash
OC_AUDIT_WEBHOOK="$OC_AUDIT_WEBHOOK" node <skill-dir>/scripts/oc-audit.mjs <mode> [args...]
```

`<skill-dir>` 替换为本 SKILL.md 所在目录的父目录的绝对路径。

### 环境变量

**必须：**
- `OC_AUDIT_WEBHOOK` — 飞书 Webhook URL

**可选（所有模式）：**
- `OC_AUDIT_AGENTS_DIR` — Agent 会话目录，默认 `~/.openclaw/agents/`
- `OC_AUDIT_REPORTS_DIR` — 报告保存目录，默认 `~/.openclaw/audit-reports/`

**analyze 模式 — LLM 深度分析（可选，不配则跳过）：**
- `OC_AUDIT_LLM_URL` — LLM API URL（Anthropic Messages API 兼容）
- `OC_AUDIT_LLM_KEY` — LLM API Key
- `OC_AUDIT_LLM_MODEL` — 模型名（默认 `claude-sonnet-4-20250514`）

**analyze 模式 — 飞书文档输出（可选，不配则通过 webhook 发送）：**
- `OC_AUDIT_FEISHU_APP_ID` — 飞书应用 App ID
- `OC_AUDIT_FEISHU_APP_SECRET` — 飞书应用 App Secret
- `OC_AUDIT_LARK_PROFILE` — lark-cli profile 名称

## 输出

脚本会：
1. 在终端打印报告摘要
2. 保存完整 Markdown 报告到 reports 目录
3. 如果设置了 `OC_AUDIT_WEBHOOK`，推送飞书卡片消息
4. （analyze 模式）如果配置了飞书应用 + lark-cli，创建飞书文档并设置公开链接

将脚本输出直接展示给用户。

## 设置自动运行

如果用户想每天自动审计，帮他设置 cron：

```bash
# 获取 node 路径
NODEBIN=$(which node)
# 每天早上 9:03 自动审计昨天
(crontab -l 2>/dev/null; echo "3 9 * * * OC_AUDIT_WEBHOOK=\"<webhook-url>\" $NODEBIN <skill-dir>/scripts/oc-audit.mjs daily >> <reports-dir>/cron.log 2>&1") | crontab -
```

# oc-audit

OpenClaw multi-agent log audit & usage analysis skill.

Audits all agent sessions — token consumption, tool call accuracy, errors, session duration — and generates structured reports with Feishu (Lark) webhook delivery. Supports LLM-powered deep conversation analysis and Feishu document output.

## Features

- **Daily Report** — audit a specific date or date range, with per-agent breakdown, tool usage ranking, and anomaly alerts
- **Full Review** — comprehensive historical analysis with employee ratings (A/B/C/D), Review Cards (strengths, issues, talking points), and review session agenda
- **Analyze Report** — weekly/monthly reports combining quantitative metrics + LLM deep analysis of conversation content (usage scenarios, task completion, pain points, recommendations)
- **Feishu Document** — create Feishu docs with public link access via lark-cli
- **Feishu Webhook** — push reports as interactive cards to your Feishu group
- **Auto-discovery** — no hardcoded paths or agent lists; detects agents from filesystem and `openclaw.json`
- **First-run guidance** — prompts for configuration on first use

## Install

Clone into your OpenClaw skills directory:

```bash
git clone https://github.com/zhupeixu/oc-audit.git ~/.openclaw/skills/oc-audit
```

## Setup

### 1. Create a Feishu Webhook (required)

1. Open or create a Feishu group
2. Group settings → Bots → Add Bot → Custom Bot
3. Copy the Webhook URL

### 2. Set environment variables

```bash
# Required
echo 'export OC_AUDIT_WEBHOOK="<your-webhook-url>"' >> ~/.zshrc

# Optional: LLM deep analysis (for analyze mode)
echo 'export OC_AUDIT_LLM_URL="<anthropic-compatible-api-url>"' >> ~/.zshrc
echo 'export OC_AUDIT_LLM_KEY="<your-api-key>"' >> ~/.zshrc
echo 'export OC_AUDIT_LLM_MODEL="claude-sonnet-4-20250514"' >> ~/.zshrc

# Optional: Feishu document output (for analyze mode)
echo 'export OC_AUDIT_FEISHU_APP_ID="<your-feishu-app-id>"' >> ~/.zshrc
echo 'export OC_AUDIT_FEISHU_APP_SECRET="<your-feishu-app-secret>"' >> ~/.zshrc
echo 'export OC_AUDIT_LARK_PROFILE="<your-lark-cli-profile>"' >> ~/.zshrc

source ~/.zshrc
```

See [references/setup-guide.md](references/setup-guide.md) for detailed instructions.

## Usage

### Daily report (default: yesterday)

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily
```

### Specific date

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily 2026-04-21
```

### Date range

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily 2026-04-01 2026-04-21
```

### Full review (all historical data)

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs review
```

### Weekly analyze report (quantitative + LLM analysis)

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs analyze 7
```

### Monthly analyze report

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs analyze 30
```

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OC_AUDIT_WEBHOOK` | Yes | Feishu custom bot Webhook URL | — |
| `OC_AUDIT_AGENTS_DIR` | No | Agent session data directory | `~/.openclaw/agents/` |
| `OC_AUDIT_REPORTS_DIR` | No | Report output directory | `~/.openclaw/audit-reports/` |
| `OC_AUDIT_LLM_URL` | No* | LLM API URL (Anthropic Messages API compatible) | — |
| `OC_AUDIT_LLM_KEY` | No* | LLM API Key | — |
| `OC_AUDIT_LLM_MODEL` | No | LLM model name | `claude-sonnet-4-20250514` |
| `OC_AUDIT_FEISHU_APP_ID` | No** | Feishu app ID for doc creation | — |
| `OC_AUDIT_FEISHU_APP_SECRET` | No** | Feishu app secret for doc creation | — |
| `OC_AUDIT_LARK_PROFILE` | No** | lark-cli profile name | — |

\* Required for LLM deep analysis in `analyze` mode. Without these, only quantitative metrics are generated.

\*\* Required for Feishu document output in `analyze` mode. Without these, report is sent via webhook. Requires [lark-cli](https://github.com/nicepkg/lark-cli) installed and configured.

## Auto-scheduling (cron)

```bash
NODEBIN=$(which node)
(crontab -l 2>/dev/null; echo "3 9 * * * OC_AUDIT_WEBHOOK=\"<webhook-url>\" $NODEBIN $HOME/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily >> $HOME/.openclaw/audit-reports/cron.log 2>&1") | crontab -
```

## License

MIT

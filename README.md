# oc-audit

OpenClaw multi-agent log audit & usage analysis skill.

Audits all agent sessions — token consumption, tool call accuracy, errors, session duration — and generates structured reports with Feishu (Lark) webhook delivery.

## Features

- **Daily Report** — audit a specific date or date range, with per-agent breakdown, tool usage ranking, and anomaly alerts
- **Full Review** — comprehensive historical analysis with employee ratings (A/B/C/D), Review Cards (strengths, issues, talking points), and review session agenda
- **Feishu Webhook** — push reports as interactive cards to your Feishu group
- **Auto-discovery** — no hardcoded paths or agent lists; detects agents from filesystem and `openclaw.json`
- **First-run guidance** — prompts for configuration on first use

## Install

Clone into your OpenClaw skills directory:

```bash
git clone https://github.com/zhupeixu/oc-audit.git ~/.openclaw/skills/oc-audit
```

## Setup

### 1. Create a Feishu Webhook

1. Open or create a Feishu group
2. Group settings → Bots → Add Bot → Custom Bot
3. Copy the Webhook URL

### 2. Set environment variable

```bash
echo 'export OC_AUDIT_WEBHOOK="<your-webhook-url>"' >> ~/.zshrc
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

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OC_AUDIT_WEBHOOK` | Yes | Feishu custom bot Webhook URL | — |
| `OC_AUDIT_AGENTS_DIR` | No | Agent session data directory | `~/.openclaw/agents/` |
| `OC_AUDIT_REPORTS_DIR` | No | Report output directory | `~/.openclaw/audit-reports/` |

## Auto-scheduling (cron)

```bash
NODEBIN=$(which node)
(crontab -l 2>/dev/null; echo "3 9 * * * OC_AUDIT_WEBHOOK=\"<webhook-url>\" $NODEBIN $HOME/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily >> $HOME/.openclaw/audit-reports/cron.log 2>&1") | crontab -
```

## License

MIT

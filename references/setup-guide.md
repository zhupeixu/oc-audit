# OC Audit 配置指南

## 1. 创建飞书 Webhook（必须）

1. 打开或创建一个飞书群（可以只有你自己）
2. 点击群右上角 **「...」→ 设置 → 群机器人**
3. 点击 **「添加机器人」→ 自定义机器人**
4. 起个名字（如"审计报告"），确认
5. 复制 Webhook 地址，格式为：
   ```
   https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

## 2. 设置基础环境变量

```bash
# zsh
echo 'export OC_AUDIT_WEBHOOK="你的Webhook URL"' >> ~/.zshrc
source ~/.zshrc

# bash
echo 'export OC_AUDIT_WEBHOOK="你的Webhook URL"' >> ~/.bashrc
source ~/.bashrc
```

## 3. 验证基础功能

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily
```

如果飞书群收到报告，基础配置成功。

---

## 4. 配置 LLM 深度分析（可选，用于 analyze 模式）

analyze 模式可以调用 LLM 分析对话内容，生成使用场景、任务完成度、痛点需求等深度洞察。

需要一个兼容 Anthropic Messages API 的 LLM 服务：

```bash
echo 'export OC_AUDIT_LLM_URL="https://api.example.com/v1/messages"' >> ~/.zshrc
echo 'export OC_AUDIT_LLM_KEY="your-api-key"' >> ~/.zshrc
echo 'export OC_AUDIT_LLM_MODEL="claude-sonnet-4-20250514"' >> ~/.zshrc
source ~/.zshrc
```

- `OC_AUDIT_LLM_URL` — API 端点，必须兼容 Anthropic Messages API 格式
- `OC_AUDIT_LLM_KEY` — API 密钥，通过 `x-api-key` header 传递
- `OC_AUDIT_LLM_MODEL` — 模型名称，默认 `claude-sonnet-4-20250514`

如果不配置，analyze 模式只会生成量化指标，跳过 LLM 分析。

## 5. 配置飞书文档输出（可选，用于 analyze 模式）

analyze 模式可以将报告创建为飞书文档，并设置公开链接权限。

### 5.1 创建飞书应用

1. 前往 [飞书开放平台](https://open.feishu.cn/app) 创建应用
2. 获取 App ID 和 App Secret
3. 添加权限：`docs:doc` (创建文档)、`drive:drive` (管理云文档权限)
4. 发布应用

### 5.2 安装 lark-cli

```bash
npm install -g @nicepkg/lark-cli
```

### 5.3 配置 lark-cli profile

```bash
lark-cli config add --name oc-audit --app-id <your-app-id> --app-secret <your-app-secret>
```

### 5.4 设置环境变量

```bash
echo 'export OC_AUDIT_FEISHU_APP_ID="your-app-id"' >> ~/.zshrc
echo 'export OC_AUDIT_FEISHU_APP_SECRET="your-app-secret"' >> ~/.zshrc
echo 'export OC_AUDIT_LARK_PROFILE="oc-audit"' >> ~/.zshrc
source ~/.zshrc
```

- `OC_AUDIT_FEISHU_APP_ID` / `OC_AUDIT_FEISHU_APP_SECRET` — 用于调用飞书 API 设置文档公开权限
- `OC_AUDIT_LARK_PROFILE` — lark-cli 的 profile 名称，用于创建文档

如果不配置，analyze 模式会通过 webhook 发送报告内容（分块发送，有 28KB 限制）。

---

## 6. 可选：自动每日审计

设置 cron 任务，每天早上自动运行并推送报告：

```bash
NODEBIN=$(which node)
(crontab -l 2>/dev/null; echo "3 9 * * * OC_AUDIT_WEBHOOK=\"你的Webhook URL\" $NODEBIN $HOME/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily >> $HOME/.openclaw/audit-reports/cron.log 2>&1") | crontab -
```

## 环境变量一览

| 变量 | 必须 | 说明 | 默认值 |
|------|------|------|--------|
| `OC_AUDIT_WEBHOOK` | 是 | 飞书自定义机器人 Webhook URL | 无 |
| `OC_AUDIT_AGENTS_DIR` | 否 | Agent 会话数据目录 | `~/.openclaw/agents/` |
| `OC_AUDIT_REPORTS_DIR` | 否 | 报告保存目录 | `~/.openclaw/audit-reports/` |
| `OC_AUDIT_LLM_URL` | 否* | LLM API URL（兼容 Anthropic Messages API） | 无 |
| `OC_AUDIT_LLM_KEY` | 否* | LLM API Key | 无 |
| `OC_AUDIT_LLM_MODEL` | 否 | LLM 模型名 | `claude-sonnet-4-20250514` |
| `OC_AUDIT_FEISHU_APP_ID` | 否** | 飞书应用 App ID | 无 |
| `OC_AUDIT_FEISHU_APP_SECRET` | 否** | 飞书应用 App Secret | 无 |
| `OC_AUDIT_LARK_PROFILE` | 否** | lark-cli profile 名称 | 无 |

\* analyze 模式 LLM 分析需要，不配则跳过深度分析

\*\* analyze 模式飞书文档输出需要，不配则通过 webhook 发送

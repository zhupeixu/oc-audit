# OC Audit 配置指南

## 1. 创建飞书 Webhook

1. 打开或创建一个飞书群（可以只有你自己）
2. 点击群右上角 **「...」→ 设置 → 群机器人**
3. 点击 **「添加机器人」→ 自定义机器人**
4. 起个名字（如"审计报告"），确认
5. 复制 Webhook 地址，格式为：
   ```
   https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

## 2. 设置环境变量

将 Webhook URL 添加到 shell 配置中：

```bash
# zsh
echo 'export OC_AUDIT_WEBHOOK="你的Webhook URL"' >> ~/.zshrc
source ~/.zshrc

# bash
echo 'export OC_AUDIT_WEBHOOK="你的Webhook URL"' >> ~/.bashrc
source ~/.bashrc
```

## 3. 验证

```bash
node ~/.openclaw/skills/oc-audit/scripts/oc-audit.mjs daily
```

如果飞书群收到报告，配置成功。

## 4. 可选：自动每日审计

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

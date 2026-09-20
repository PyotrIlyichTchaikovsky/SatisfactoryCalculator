# 真实部署环境的 BUG 上报验收

## 三个环境的约定

| 环境 | 标识 | 用途 |
|---|---|---|
| 本地开发 | development | 编写代码；本次不提供开发环境的上报验收入口 |
| 发布测试 | staging | 与生产采用相同程序和上报路径，人工做产品系统测试 |
| 生产 | production | 面向玩家；可主动验证真实生产 BUG 上报 |

在 staging 测试时事件仍标记 staging，在 production 测试时仍标记 production。不会把生产错误转发到本地，也不会换成测试 DSN。两端都使用该部署实际的 DSN、release、网络和告警配置，测试事件额外带 `monitoring_test=true`。

环境隔离和人工晋级由 `.github/workflows/release.yml` 统一处理，配置与操作步骤见 [RELEASE.md](RELEASE.md)。GitHub Environments 分别提供 staging / production 配置；不是仅凭 staging 分支名称切换环境。云端配置完成并启用流水线后，合入 main 的候选版本先去发布测试站，人工批准后才发布生产。

## 已保留的问题定位能力

- 每个正式 API 响应有服务端生成的 `X-Request-ID`，以及 `X-Planner-Release`、`X-Planner-Data-Version`。允许的跨域前端可读取。
- 后端 JSON 日志含 request_id、环境、release、状态和耗时，可在 Cloud Logging 中持久化检索。`/api/metrics` 仍是进程内即时计数，不是持久化监控。
- Sentry 异常带对应 request_id；前端反馈报告可以查看、复制、下载当时与当前方案以及最近请求。
- `/api/health` 返回环境、版本和计算依赖状态；真实计算检查可使用 `scripts/check_planner_service.py`。
- 自动上报清理请求、用户信息和局部变量；不自动上传完整方案。玩家可以查看报告后自行决定是否分享。令牌不会进入报告或日志。

## 一、测试真实前端上报

### 前置条件

目标站已构建并部署本次代码：

- 前端 `SENTRY_ENVIRONMENT` 为 `staging` 或 `production`。
- `SENTRY_FRONTEND_DSN`、`SENTRY_BROWSER_SCRIPT_URL` 已正确配置；构建时前端 DSN 传入 `SENTRY_DSN`。
- `SENTRY_RELEASE` 是实际发布提交号，Sentry 通知接收渠道已配置。

### 操作

在你要验收的站点 URL 后加：

```text
?monitoring_test=frontend
```

例如生产域名为 `https://你的生产域名/`，就打开：

```text
https://你的生产域名/?monitoring_test=frontend
```

发布测试站用同一个标记，只替换成测试站的域名。已有查询参数时使用 `&monitoring_test=frontend`。

页面加载后会异步抛出一次带测试标记的真实 JavaScript 异常，由页面的全局异常处理器和实际 Sentry SDK 上报；不会调用模拟 Sentry，也不改动计算目标。每次打开/刷新带标记的页面触发一次，移除标记后恢复普通访问。

页面上方会显示环境、问题编号和“已捕获，仍需核对送达”的提示。如果 SDK/DSN 缺失，会明确提示配置失败，不声称发送成功。

### 验收标准

1. 页面显示的环境确实是你要测试的环境。
2. 页面显示测试异常的 Problem ID；在 Sentry 中确认该事件的 `issue_id` 一致，且 `monitoring_test` 为 `true`。公开页面不提供人工报告入口。
3. 在该前端 Sentry 项目中查询 `issue_id:页面编号`，看到 `Planner frontend monitoring test`，环境、release 正确，并带 `monitoring_test=true`。
4. 在实际通知渠道收到告警，核对问题/事件链接。捕获或入队不等于通知已经送达。
5. 移除 URL 标记后刷新，再正常计算一次，页面仍可使用。

前端测试异常不调用后端，因此没有后端 request_id，不应该在 Cloud Run 中找到这一条前端异常。后端链路用下面的 API 单独验证。

## 二、测试真实后端上报

### 配置专用令牌

在待验收后端设置 `PLANNER_MONITORING_TEST_TOKEN`，使用至少 32 字符的随机令牌。staging 和 production 使用各自独立的令牌。可以用密码管理器生成；保存在服务端环境/Secret Manager 与你的密码管理器中，不放在前端、URL 或代码仓库。

GitHub 的 staging / production Environments 分别配置同名 Secret，由统一发布工作流传入后端。令牌为空或不足 32 字符时，测试 API 不启用；不影响正常计算。实际 Sentry DSN 和 SDK 缺失时测试返回 503，并指出配置问题。

### API

```http
POST /api/monitoring-test
Authorization: Bearer 对应环境的专用令牌
Content-Type: application/json

{}
```

认证通过后抛出 `MonitoringTestError`，经过正常的 API 异常处理、Sentry 捕获及 JSON 日志路径。

**预期响应就是 HTTP 500**，示例：

```json
{"error":"Intentional monitoring test.","monitoringTest":true,"environment":"production"}
```

响应头 `X-Request-ID` 是本次核对编号。测试不启动求解器、不修改玩家数据。为了避免误操作连续刷告警，每个服务进程有 30 秒冷却；多实例不是全局限流，主要访问保护仍是专用令牌。

### 推荐操作：运行远程验收命令

本机只是发 HTTP 请求，不需要运行本地计算器或安装 SciPy/Sentry。脚本只用 Python 标准库，异常发生在你指定的真实远端服务。

PowerShell：

```powershell
$env:PLANNER_MONITORING_TEST_TOKEN = '替换为该环境的令牌'
python scripts/check_bug_reporting.py https://你的生产API域名 --environment production
```

测试发布测试环境：

```powershell
python scripts/check_bug_reporting.py https://你的发布测试API域名 --environment staging
```

脚本先读取远端 `/api/health` 核对环境，再调用远端测试 API；环境不一致时不会触发测试异常。只接受 HTTPS，并禁止重定向转发令牌。正常触发后显示 `TEST_ERROR_TRIGGERED`、request_id 和 release。这只证明异常已在远端触发，送达和通知仍需手工核对。

### 验收标准

1. 脚本返回预期环境、request_id 和实际发布版本。
2. 在该后端 Sentry 项目查询 `request_id:编号`，看到 `Planner backend monitoring test`，且有 `monitoring_test=true`、正确环境和 release。
3. Cloud Run 的 Logs Explorer 使用下面条件查到同一请求的异常日志和状态 500 的请求日志：

```text
resource.type="cloud_run_revision"
jsonPayload.request_id="替换为本次编号"
```

4. 日志有 `monitoring_test=true`；没有 Authorization 或令牌内容。
5. 实际通知渠道收到告警。完成后普通 `/api/plan` 仍能正常计算。

响应解释：401 是令牌错误，404 是入口未启用/环境不支持/旧部署未更新，429 是仍在冷却期，503 表示监控配置不完整（或基础设施不可用）。只有带 `monitoringTest=true` 和 request_id 的预期 500 才算测试已触发；普通网关 500 不能算。

## 三、事件到了但通知没到

按“页面/API 已触发 → Sentry 有事件 → 通知已送达”分别记录。

检查 Sentry 规则的环境过滤、通知接收人确认、新问题/再次发生条件和重复通知间隔。测试事件可能被归为同一个问题，多次触发不一定每次都通知。

若生产告警规则要求一定时间内多次错误才触发，单次测试可以验证收件，但不能证明达到阈值后的告警。不要为测试盲目制造大量生产 500；先在发布测试环境验证相同规则，记录生产侧通知的实际验收范围。`monitoring_test` 标签用于辨认演练事件，不能一边将它从全部告警规则排除，一边声称已经验证正常告警链路。

Cloud Monitoring 的日志指标/告警还需在云端配置；结构化日志代码不等于云端告警已创建。测试后可清理/归档 Sentry 的测试问题，但不要把整个真实项目的告警关闭。

## 验收记录

| 项目 | 发布测试 staging | 生产 production |
|---|---|---|
| 时间、前端 release、后端 release | | |
| 前端 issue_id，Sentry 事件链接 | | |
| 前端通知接收时间 | | |
| 后端 request_id，Sentry 事件链接 | | |
| Cloud Run 对应日志 | | |
| 后端通知接收时间 | | |
| 正常计算、反馈报告仍可使用 | | |
| 尚未验证的监控/告警项 | | |

这些步骤必须在实际部署后执行。本地自动化测试验证实现与权限分支，不作为生产 Sentry、Cloud Logging 或通知送达的证据。

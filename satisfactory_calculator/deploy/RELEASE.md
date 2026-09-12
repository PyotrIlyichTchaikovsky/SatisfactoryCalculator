# 发布测试 → 人工批准 → 生产：配置与操作指南

## 当前代码实现的流程

`main` 的每次提交进入 `Release planner`：自动检查 → 构建一次后端镜像 → staging 部署 → 真实 API 与浏览器测试 → 等待 production 人工批准 → 复用镜像摘要和同一提交 → 生产检查 → 失败时恢复。

普通 PR 只运行 CI，没有云端部署凭据。旧的独立前端/后端发布工作流已经移除。

**默认不部署。** 仓库变量 `RELEASE_PIPELINE_ENABLED` 未设为 `true` 时，只执行检查。下面准备完成前不要开启此开关。代码提交也不会自动替你创建云资源、启用审批人或配置告警。

## 第一步：GitHub 环境与人工批准

仓库 Settings → Environments：

1. 创建 `staging`，不设置人工审批，允许 main 部署。
2. 创建 `production`，在 Required reviewers 中选你自己。
3. 单人维护时不要勾选 Prevent self-review，否则你无法批准自己触发的发布。
4. 限制 production 的部署来源为 main；不要启用管理员绕过审批。
5. 确认页面确实保存了 Required reviewers，再继续后续配置。仅在代码里写 `environment: production` 不会自动产生人工审批。

Settings → Rules / Branches：给 main 设置 PR 合并和必需 CI 检查（先让新 CI 运行一次后选择实际出现的检查名称）。仓库保持当前公开属性时可使用这些环境审批能力；更改仓库可见性前先核对 GitHub 套餐支持。

## 第二步：两套真实站点

| 资源 | staging | production |
|---|---|---|
| Cloudflare Pages 项目 | 独立测试项目 | 独立生产项目 |
| Cloud Run 服务 | 独立测试服务 | 独立生产服务 |
| Sentry environment | staging | production |
| API 地址与跨域来源 | 测试 API / 测试站 | 生产 API / 生产站 |
| 测试令牌 | 随机令牌 A | 不同的随机令牌 B |

两个 Cloud Run 服务可以位于同一个 Google Cloud 项目和区域。固定名称后不要随意更换，因为恢复记录会核对完整资源身份。

### Cloudflare

- 创建两个 Pages 项目，推荐 Direct Upload，使用各自的固定 `*.pages.dev` 地址或自定义域名。
- **两个项目各自的 production branch 都设置为 main。** staging 是独立 Pages 项目，不是生产项目的临时预览分支，因此可以拥有固定地址和自己的回滚历史。
- 已有 Git 集成项目需要先关闭平台自动生产部署；发布脚本会检查，防止绕过 GitHub 的审批。同时关闭不需要的 Git 预览构建，避免产生另一套未受控测试站。
- 创建限定到目标账户、具备 Pages 编辑权限的 API Token，并记录 Account ID。无需把令牌发在聊天中。
- 第一版默认测试站可直接访问，但加醒目的测试标识、robots 禁止索引和 X-Robots-Tag。它不是访问控制；若需要登录保护，先配置 Cloudflare Access，并适配自动测试的服务凭据后再开启流水线。

### Google Cloud

- 启用 Cloud Run、Artifact Registry、IAM Credentials、Security Token Service 等所需 API；创建 Docker 格式的镜像仓库。
- 创建两套 Cloud Run 服务并记录真实 URL。首次可以用控制台示例容器占位取得 URL；示例容器不是有效的稳定版本，发布检查通过前不能当成上线完成。
- 设置 GitHub Workload Identity Federation，分别授权 staging / production 部署身份；信任条件限制到本仓库、main 和对应 GitHub Environment。新增 Environment 后 OIDC subject 与原来仅按分支授权的 subject 不同，需要核对现有绑定。
- 部署身份需能推送镜像（staging）、读取已测试镜像（production）、部署及读取 Cloud Run、切换流量、设置公开调用，以及使用运行服务账号。生产服务的运行身份也要能拉取该镜像。避免在聊天中传递服务账号密钥。
- API 为公开调用，浏览器跨域只允许对应网站。监控测试 API 仍要求专用令牌。
- 代码默认两环境都是 1 CPU、1 GiB、请求并发 8、最小实例 0；最大实例 staging 默认 1、production 默认 3，可用下表变量调整。设置账单预算提醒。此配置需要在真实 staging 上确认能满足响应时间。
- 保留可回滚镜像和 Cloud Run 历史版本，清理策略不要删除仍计划恢复的版本。

## 第三步：按环境填写配置

分别进入 GitHub Settings → Environments → staging / production。不要把生产专用密钥继续放在仓库级，避免旧工作流重跑时仍能绕过环境审批。共享非敏感配置可以放仓库级，但服务名、站点/API 地址等建议分别放在环境内。

### Variables

| 名称 | 内容 |
|---|---|
| GCP_PROJECT_ID | Google Cloud 项目 ID |
| GCP_REGION | 服务和镜像仓库所在区域 |
| ARTIFACT_REGISTRY_REPOSITORY | 镜像仓库名，staging 构建时使用 |
| CLOUD_RUN_SERVICE | 该环境 Cloud Run 服务名；名称应足够短，追加发布编号后总长不超过 63 |
| CLOUDFLARE_PAGES_PROJECT | 该环境 Pages 项目名 |
| PUBLIC_SITE_URL | 该网站 HTTPS 根地址，不带路径和查询参数 |
| PLANNER_API_BASE_URL | 该环境真实 API HTTPS 根地址 |
| SENTRY_FRONTEND_DSN | 该环境前端实际 Sentry DSN（本来就是浏览器公开配置） |
| SENTRY_BROWSER_SCRIPT_URL | 固定版本的 Browser SDK URL，避免验收期间 SDK 无声变更 |
| CLOUD_RUN_MAX_INSTANCES | 可选，正整数；测试默认 1，生产默认 3 |
| ADSENSE_ENABLED / ADSENSE_CLIENT | 可选，默认关闭；需要广告时明确配置并在测试站验收 |
| ALLOW_UNMANAGED_BASELINE | 仅首次接管旧生产站时可能使用，见下面迁移说明；默认不设置 |

### Secrets

| 名称 | 内容 |
|---|---|
| GCP_WORKLOAD_IDENTITY_PROVIDER | 对应环境的身份提供者资源名 |
| GCP_SERVICE_ACCOUNT | 对应环境的部署服务账号 |
| CLOUDFLARE_ACCOUNT_ID | Pages 所属账户 ID |
| CLOUDFLARE_API_TOKEN | Pages 部署令牌 |
| SENTRY_DSN | 后端实际 Sentry DSN |
| PLANNER_MONITORING_TEST_TOKEN | 该环境至少 32 字符的随机 BUG 验收令牌 |

SENTRY_ENVIRONMENT 和 SENTRY_RELEASE 由工作流自动设置，不要手工复制为 production。前端环境配置生成在部署产物中；后端密钥使用临时文件传给 gcloud，该文件不进入 Git、Docker 上下文或 Actions 附件。

## 第四步：启用和首次验收

1. 核对 production 的审批规则、域名、环境配置及账单设置。
2. 提交并推送经确认的代码，让 CI 先通过。
3. 将仓库 Actions Variable `RELEASE_PIPELINE_ENABLED` 设置为 `true`。
4. Actions → **Release planner** → Run workflow，选择 main。
5. staging 成功后，运行摘要会显示网站链接、完整提交号和发布编号，例如 `12345678-1`。
6. 打开测试站：检查页面上的版本；计算简单/复杂产线，切换配方、保存目标、刷新恢复，测试大图和反馈入口。需要时按 [MONITORING.md](MONITORING.md) 验证真实 BUG 收件与通知。
7. 验收通过，在同一次运行中批准 production。生产自动执行检查，成功后生成 GitHub Release 和对应恢复附件。
8. 再按生产地址人工核对一次。云端首次上线与回滚必须实际演练；本地单元测试和浏览器测试不能替代真实平台验收。

首次没有完整上一版时，不可能真正回滚到“空版本”。若检查失败，流程会标记 `recovery_required` 并保留记录，不会误报恢复成功。首次成功后才建立可验证的稳定版本对。

若已有生产站但没有 `release.json`，默认停止接管，以免把未知状态当作稳定版本。先记录当前 Pages 部署和 Cloud Run 版本、确认现有站可用，再为这一次迁移设置 `ALLOW_UNMANAGED_BASELINE=true`。脚本会保存旧部署信息并提供基本页面/计算恢复检查；迁移成功后移除此变量。无法恢复的旧部署、不同域名或旧页面行为仍需人工处理。

## 日常发布的版本约束

- 后端镜像仅在 staging 构建一次；production 使用 `@sha256:...` 摘要，不使用可覆盖的 latest 标签。
- 前端应用代码、图标、游戏数据的摘要在两环境核对。API、Sentry、站点地址等环境配置允许不同；打包时不重新安装 Python 依赖、不重新构建后端。
- `release.json` 可检查前后端 SHA、游戏数据版本及环境配置摘要；前端页面会显示版本，staging 有明确标识和防索引响应头。
- 同一时刻只保留一个正在验收的候选流程。等待人工批准期间，新的 main 更新排队，测试站不会悄悄覆盖。需要修复时拒绝/取消旧候选，再运行新候选。
- GitHub 默认并发队列可能只保留最新待执行运行，中间提交仍有 CI 检查，但不保证每一个都部署测试站。
- 生产发布前再次读取 staging 版本；若有人手工改动测试站，旧候选不会发布。
- 失败后需要重新走候选流程时，使用 **Run workflow**（新运行）或重跑全部任务，不要只重跑失败的 production 任务；不同 attempt 的候选附件不会混用。

## 回滚：自动与手动

### 自动

修改云端前先保存并上传 `recovery-production-发布编号`。随后创建新后端版本；已有后端时先不接正式流量，通过标签 URL 验证计算，再切后端、发前端并检查正式站。

发布中途或正式站检查失败，脚本尝试恢复原前端部署和后端流量，并再次验证。一个平台恢复失败时仍会尝试另一个；恢复不完整时标记 `recovery_required`，工作流保持失败。失败时的浏览器证据单独保存在 `release-work/failed-browser/`，不会被恢复后的检查覆盖。

两个平台不是原子事务。新后端必须兼容仍打开旧页面的用户；破坏性 API/数据格式修改需分阶段发布。当前只处理代码、静态资源和运行配置，不涉及数据库迁移。

### 手动

Actions → **Roll back production**，选择 main：

- `release_id`：运行摘要显示的编号。
- `target=after`：恢复到该次**成功发布**的前后端版本。使用 GitHub Release `planner-编号` 的长期 `production.json` 附件。
- `target=before`：恢复到某次发布尝试**开始之前**的状态，适用于中断、取消或失败的发布。使用该次提前保存的 recovery 附件。

手动回滚也需生产审批，与生产发布共用互斥锁。紧急回滚前先拒绝/取消等待批准的候选；如果正在真正切换生产，优先让其完成自动恢复，避免同时手工操作云平台。强制取消后可使用 before 快照恢复。

普通诊断附件和 before 快照保留 90 天；成功版本的恢复记录放在 GitHub Releases 长期保留。至少保留最近 5 套对应 Pages 部署、Cloud Run revisions 和镜像，**仅保留 JSON 而删除云端版本也无法回滚**。

若成功上线后 GitHub Release 归档失败，生产已经通过检查，不会因归档服务短暂失败而再次切换。先下载 `production-编号` Actions 附件中的 transaction.json，补存为对应 GitHub Release 的 production.json；归档完成前常规 after 按钮不能使用，before 快照仍可用于恢复上一版。

## 测试与验收边界

已加入：计算回归、发布状态机的失败注入测试、配置与候选一致性校验、真实跨域浏览器操作、工作流语法检查。自动部署会验证真实站点，但本地没有 Google Cloud / Cloudflare 账号上下文时，无法提前证明云端权限、DNS、镜像拉取和平台 API 行为全部正常。

上线几小时后才发生的问题，由监控通知你后手动选择稳定版本回滚；这版不做长期无人值守自动回滚。

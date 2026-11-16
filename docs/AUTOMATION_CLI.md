# StarCanvas CLI / MCP 自动化

## 1.4.9：App、CLI 与 MCP 共用授权底座

本版本包含多会话主智能助手、角色工作台、受控画布操作，以及配套 CLI/MCP。
已在 macOS arm64 与 Windows x64 隔离安装版验证升级、凭据保存、素材与创作流程。
模型请求、上传和轮询验收使用本机模拟服务，不代表支持所有上游模型或已验证真实计费。
外部连接默认只有元数据读取权限：
`status`、`models`、`tasks`、`task get/wait` 可查询；不会默认返回提示词、
原始错误或媒体/文件地址，也不会因查询任务就下载、导出素材。
文生图、文生视频、天玑文生视频和停止任务已接入逐次 App 审批；生成还需
勾选本次可能收费的确认。旧路径/URL 参数已接通自动分步申请：
每份素材分别确认导入，最后再单独确认生成，查询同一个原始流程回执；
单条已完成结果的导出已接通独立审批，不随普通任务查询隐式执行。
也可先单独审批导入，再用临时编号提交另一次生成审批。两种方式共用相同授权和执行底座。
不能用请求里的 `confirmed` 或 `permissions` 字段自行授权。
命令名称和旧别名保留；生成与导出改为应用端逐次审批，而不是接入即授权。

生成的原授权现在还会在实际输入上传和首次模型提交前复核项目、会话、配置及
目标/参考节点。上传等待时更换配置，不会把旧确认用于新配置；同一授权最多
发起一次模型提交，受控异步图片失败不会自动付费重发。已开始的上传或请求
不承诺撤回。只有正常发送器确实发起提交后才返回 accepted；发送前正常退出
会返回 `OPERATION_NOT_SUBMITTED`。超时未知状态请查询原回执，不要重提。
质量档位图片会在审批中显示明确比例，不隐式调用另一个文本模型分析 Auto。

天玑审批现显示实际公共表单字段，包括音频和水印；受控发送使用已确认的
模型、模式、分辨率、时长、比例等，不会被普通 Seedance 默认值替换。
明确选择的天玑节点参数在运行时回调同步和项目恢复时保留；它们只是普通
节点数据，不保存任何授权。受控发送不触发旧版极鑫配置自动回写。
源码已验证内置助手/真实 CLI/stdio MCP 的画布计划、确认、撤销及错误边界
一致；App、CLI、MCP 共用无依赖的公开权限/错误码表。
便携 bin-only CLI 与隔离 App 模块布局已验证，不依赖源码目录补齐文件。
未知错误码和原始后端错误仍被脱敏，不会因统一错误格式放宽权限。

新增的结构化画布操作已接通源码 App 审批面板：CLI/MCP 提交请求后，
画布修改、撤销和节点文字分享必须在 App 内逐次确认。它们复用既有画布
计划控制器，不启动生成。内置助手的画布规划及旧的单文字/图片/视频节点
确认按钮也已接入同一主进程服务，按会话隔离并在原确认按钮处授权。
单节点会进入相同的撤销/结果查询流程，不额外请求模型、不开始生成。
基础主题、语言、自动下载及页面导航也已接入同一授权服务；
任务读取已迁入公共来源与状态投影；天玑审核人像 ID 已接通受控核验。
源码验收使用本机模拟上传/模型服务，不代表已验证全部上游模型或实际收费链路。

当前客户端除 `status` 外要求 App 自动化协议版本 2；遇到旧版 App 会在发送
读取内容或写操作前返回 `OPERATION_APP_UPGRADE_REQUIRED`，不会自动降级。
旧版客户端不会因此获得新能力，请同时更新 App 和工具包。

### 参考素材导入与二次生成审批

```bash
node bin/starcanvas.mjs media import --type image --source /absolute/reference.png --project default --request-id example-media-import-0001
```

MCP 对应 `starcanvas_import_media`；也可提交 `media.import`，arguments 为
`{type:"image"|"video"|"audio",source:"绝对路径、file URL 或公开 HTTP(S) 地址"}`。
HTTP `POST /v1/media/import` 沿用现有幂等键与操作回执规则。返回 request/receipt，
在 App 审批前不读文件或下载，不会开始生成。精确文件授权不代表目录访问；
本地扩展名与实际媒体签名均需通过，不接受任意文件、UNC/设备、符号或硬链接。
网络检查复用公网 DNS 固定、跳转重验、无认证/Cookie、限时限量流程，上限 512 MiB。

批准并核验后，查询原操作返回 referenceId、项目、类型、MIME、字节数、SHA 和
expiresAt；不返回原路径、上游 URL、本地路径或内容。编号绑定调用身份和项目，
不晚于本次请求过期时间失效，重启不恢复。外部调用沿用同一个 external 身份类，
不是新的逐 MCP 进程登录体系。`media.reference.release` 的 arguments 仅含
`{referenceId}`，需原 projectId；同一身份可在离开该项目后释放，不删除文件。
导入的媒体可继续留在托管库，批准说明已明确这一点。

生成参数 `references` 接受上述编号数组；CLI 可重复使用 `--reference-id`，
MCP 的三个生成工具也提供 `references`。不要把编号填入旧 `referenceImage`。

```bash
node bin/starcanvas.mjs image generate --prompt '示例需求' --reference-id reference-11111111-2222-4333-8444-555555555555 --project default --request-id example-reference-generate-0001
```

示例编号须换成实际导入结果。生成还要在 App 单独确认，素材会经既有上传/
模型流程发送，可能生成公网素材链接；不分享文件路径或私密上传配置给 Agent。
确认前不解析文件字节、不创建生成节点；确认后仍核对身份、项目、过期、文件
哈希和当前配置，再复用正常节点/连线、上传、请求、轮询及保存。返回 nodeId
只表示本机开始提交，必须继续查询任务，不代表上游已受理或结果完成。

图片只接收图片参考；普通 multipart 视频依实际字段配置校验类型；当前普通
JSON 视频只发送图片，多图还需数组模式，不支持的类型/数量明确拒绝。
天玑可用 `--mode first-frame|first-last|reference-media`；分别严格检查一张图、
两张图或参考媒体，未指定且使用编号时默认 reference-media。天玑已在隔离源码
窗口验证真实上传 IPC 配合 SHA 核验的本机模拟上传、提交和轮询；不代表已调用
真实公网上传商或付费模型；完整阶段验收还结合统一权限和三入口对照证据。

### 旧路径/URL 命令的自动分步申请

```bash
node bin/starcanvas.mjs image generate --prompt '示例需求' --reference /absolute/reference.png --project default --request-id example-legacy-workflow-0001
node bin/starcanvas.mjs video generate --prompt '示例需求' --image https://example.com/reference.png --project default --request-id example-legacy-workflow-0002
node bin/starcanvas.mjs tianji generate --prompt '示例需求' --mode first-last --image /absolute/first.png --image /absolute/last.png --project default --request-id example-legacy-workflow-0003
```

URL 必须通过现有公网 DNS/跳转/签名检查；请求本身不会预读文件或下载。
每份原始素材生成一个普通 `media.import` 审批，全部导入后才出现普通
付费生成审批。App 卡片显示当前步骤；批准导入不会自动批准下一份或付费生成。
CLI/MCP 查询最初的 request.id/receipt 即可跟踪整个流程，无须复制中间编号。
`workflow` 返回阶段、当前步、总步和已导入数量，不返回来源或私有子回执。
最终 result 与普通生成提交相同，仍需用 nodeId 查询结果任务。

普通提交和分步提交共用调用身份+幂等键命名空间；改变路径、内容或请求形态
复用同一键会冲突，不能生成两份。所有步骤共享最初的到期时间及内部会话
选择版本，不因进入下一步续期。拒绝或取消待确认步骤会停止后续步骤。
导入已经开始时取消可能先返回 `outcome_unknown` 和 `nextStepsCancelled`；
只观察同一操作直到完成，不重发导入，已批准的媒体可能继续保留。
付费生成开始后取消流程可能返回 `OPERATION_TOO_LATE`，不声称上游停止/退款。

天玑原始 images/videos/audios 保留顺序与类型；省略 mode 时，有素材默认
reference-media，无素材默认 text-to-video，显式模式不会被覆盖。原始来源
暂不与已有 references 混用；可与 portraitAssetIds 一起提交，仍分别导入普通
素材，并在最终确认后核验人像 ID。ID 不会被当作图片 URL 或文件路径导入。

实际 Mac 源码窗口已验证旧 CLI 图片路径和 MCP 视频路径经两次确认、正常
生成 hook、结果任务及视频播放；仅本地模拟接口，无真实上游或付费请求。
天玑首尾帧的实际节点/连线由隔离 root 测试覆盖，不等于其完整上传链路验收。

### 天玑审核人像 ID

```bash
node bin/starcanvas.mjs tianji generate --prompt '示例需求' --model MODEL_ID --portrait-asset-id YOUR_ASSET_ID --project default --request-id example-portrait-generate-0001
```

MCP 对应 `starcanvas_generate_tianji_video` 的 `portraitAssetIds` 数组；也可使用
统一 `generation.tianji` 操作。ID 最多 9 个，不可重复，只允许 reference-media；
普通图片参考与人像 ID 合计最多 9 项，总媒体最多 15 项。不接受调用者提供
Active 状态、节点绑定数据、预览 URL 或私有完成凭据。

准备阶段只展示 ID 和核验说明，不查询服务商、不上传或创建节点。批准本次
付费生成后，通过当前配置及已有 AIGC/LivenessFace 分组，调用现有只读素材
列表接口，要求请求中的 ID 当次可用。分组未配置会明确报错，不自动创建。
查询受 15 秒、每组 8 页、每页 100 项约束；无法完整核验、状态待审核/失败、
身份有歧义、网络错误或权限失效，都不会创建生成节点或提交模型请求。
分页达到限制返回 OPERATION_LIMIT；其他核验失败一般为 OPERATION_MEDIA_NOT_READY。
查询使用现有 statuses=Active 列表契约；上游明确返回的非可用状态不会被覆盖。

核验后再次比较配置/分组、项目及会话范围，才创建正常的人像引用节点与天玑
生成节点，交由现有收集器、请求构造器及轮询执行。不下载/上传预览图，不把
人像混入普通 HTTP 图片数组；正常上游字段使用 asset://ID。无预览的人像节点
直接显示绑定状态和 ID，不再与“空”占位重叠。它仍使用正常项目保存流程。

Active 仅表示查询时可用，不保证之后的上游状态、受理或结果。操作 completed
仍只表示本机提交，需查询任务。执行中的流程不承诺可撤回/退款，不自动重试。
实际 Mac 源码已用 CLI/MCP 和本地模拟服务跑通核验、正常天玑 form 请求、轮询、
完成记录与视频播放；无真实服务或付费调用。另有普通素材上传 IPC、实际发送前
配置绑定复核及天玑公共表单字段对照；这不扩展为全部专用协议/上游兼容声明。

### 统一任务读取

内置助手的状态、进度、选中任务排错和摘要读取，与 CLI/MCP 的
`tasks.list/get` 使用同一个根级任务读取器。它只读取最后的本地记录，
不查询上游、不重试、不下载素材。切到设置等页面仍可读取；缺失或损坏的
数据返回 `OPERATION_TASKS_UNAVAILABLE`，不是空列表或生成失败。
自定义节点使用真实输出类别；缺失进度为 `null`，不会捏造 `0%`。
同时存在“完成”与停止标记时为 `unknown`。节点 ID 别名必须能够根据
可比较且不并列的创建时间唯一选定；重复任务 ID 或顺序不明返回
`OPERATION_TASK_AMBIGUOUS`，不会随意选择一条。时间保留合法的原有格式。

普通任务查询不扫描原始错误。仅显式排错时，可提交
`tasks.list` 的 `{includeDiagnostics:true}` 或 `tasks.get` 的
`{id:"TASK_ID",includeDiagnostics:true}`，获得失败任务的固定 HTTP 状态及
粗略错误类别，仍无提示词、原始错误、凭据或媒体地址。旧 HTTP 读取端点的
等价显式参数为 `?diagnostics=1`。旧 `tasks` / `task get/wait` 默认不带诊断。
旧 GET 轮询直接调用同一个读取器，不为每次轮询保留操作任务；结构化提交和
内置助手仍经主进程操作服务。两种传输不维护不同的任务业务实现。

每个助手会话只保留自己的短期查询状态，重复点击共用同一次读取。
切换会话不转移结果，也不清空后来编辑的草稿；查询句柄和 Promise 不落盘。

### 单条任务结果导出

```bash
npm run starcanvas -- task export TASK_ID --project PROJECT_ID --request-id export-request-0001
```

MCP 为 `starcanvas_export_task`，参数为 `{id,projectId,idempotencyKey}`；
也可提交 `media.export`，arguments 只接受 `{id}`，必须提供 projectId。
旧端点对应 `POST /v1/tasks/TASK_ID/export`。只接受当前项目内已完成且无矛盾
状态的图片、视频或音频任务；节点 ID 别名仍必须唯一定位。没有任意源地址、
目录、请求头、Cookie 或覆盖选项。

提交仅返回操作句柄及 receipt。App 中会单独说明要导出的任务、可能下载结果、
向本机智能体提供文件位置，以及不分享提示词/上游地址/凭据。只有单次批准后
才读取结果；拒绝/取消不执行。完成后用原 receipt 查询同一操作，可得
`exported、taskId、projectId、type、localPath、resultUrl、mime、size、sha256`。
`resultUrl` 仅为此次批准结果的本地 file URL，绝不返回上游地址。
重复键复用原请求；观察超时不是失败，不要换新键重做。

主进程使用默认下载位置的既有托管媒体库归档结果，不覆盖已有冲突文件。
本地源限于此项目或已登记媒体库的托管 blob；拒绝跨根路径、符号链接与硬链接。
远程结果使用无认证、固定公网 DNS 地址的 GET，每次跳转重新验证，禁止私网、
混合 DNS、HTTPS 降级与自动 Cookie；分段下载、限时限量，再核对实际类型和
归档文件的字节哈希。默认上限 512 MiB，非任意文件导出接口。

该入口通过与内置会话相同的操作服务、主进程 finalizer 和存储写入器运行。
内置 owner IPC 的确认/隔离已验收；本轮没有在助手聊天中增加新的自然语言
导出按钮，也不自动把导出文件作为聊天附件或模型上下文。CLI/MCP 仅在 App
运行时可申请；重启不恢复审批或操作句柄。

### 基础设置与导航

`app.preferences.read` 只返回当前主题 ID、语言 ID 和自动下载布尔值，不返回
API/账号凭据或完整配置。`app.preferences.set` 接受 `{kind,value}`：
`kind=theme|language|autoDownload`；主题和语言必须是界面实际支持的枚举，
自动下载必须是布尔值。它不是可写入任意设置的接口。

`app.navigate` 接受 `{destination}`，支持 `canvas/resources/agents/workspace/`
`settings/account/appearance/api/models/generation`，只打开页面，不修改其中配置。
企业托管限制仍生效。设置和导航均要求 `projectId`，分别使用
`preferences.edit`、`app.navigate` 权限；CLI/MCP 的请求必须在 App 内逐次确认。
内置助手的明确用户命令或建议确认按钮通过同一服务提交，不直接调用设置器。

```bash
node bin/starcanvas.mjs operation submit --json '{"operation":"app.preferences.read","arguments":{},"idempotencyKey":"example-preferences-read-0001"}'
node bin/starcanvas.mjs operation submit --json '{"operation":"app.preferences.set","projectId":"default","arguments":{"kind":"theme","value":"graphite"},"idempotencyKey":"example-preferences-set-0001"}'
node bin/starcanvas.mjs operation submit --json '{"operation":"app.navigate","projectId":"default","arguments":{"destination":"appearance"},"idempotencyKey":"example-navigation-0001"}'
```

设置成功结果的 `saved=true` 与 `visuallyApplied=true` 来自既有存储写入/读回及
实际界面或监听器，不是仅接收了请求；不承诺突然断电后的持久性。导航成功
要求实际目标内容可见。预览展示的是捕获时的值，后续手动修改或切换项目、
会话会使旧确认失效。超时或提交后的保存/显示失败保持结果未知，用原 request
查询，不会自动重写；重启不恢复请求授权，也不自动执行历史记录。

### 受控生成与停止

旧 `image/video/tianji generate` 与 `task cancel` 现在返回 HTTP 202 的
`{request,receipt,replayed}`，不是立即返回已生成素材。可用 `--project` 指定
项目、`--request-id` 指定幂等键；不指定项目时绑定提交时的当前项目。
客户端每次新调用生成一个幂等键；不确定写入不重试，错误会携带该键供核对。
手工 HTTP 调用必须提供 `Idempotency-Key` 或 body 的 `idempotencyKey`。

请用 `operation get REQUEST_ID --receipt RECEIPT` 查询审批/提交结果；只有
生成操作完成后才返回 `result.nodeId`，随后用 `task get/wait NODE_ID` 查询生成。
`generationStarted=true, generationCompleted=false` 只证明本机调用了正常生成
流程，不证明上游已受理或生成完成。预检不访问端点、不检查余额或价格。
通用视频的审批会区分画布选择与“实际发送字段”，使用与正常生成相同的
协议、时长和请求体转换；例如输入尺寸可能变成画质档位。私密或未识别的
额外字段只显示隐藏数量，不返回完整配置或凭据。受控质量图片显示明确比例；
天玑显示其七项实际公共 form 字段，并与实际发送做了对照。不能据此推断全部模型。
缺失协议、无效模型参数在审批前拒绝。结构化 generation.* 不接受原始文件/URL
作为授权；旧命令则走上面的分步导入。未取得有效素材范围时返回
`OPERATION_MEDIA_SCOPE_REQUIRED`，不会假装生成时使用了参考素材。

停止也需单独审批并核对项目及当前任务身份，不允许旧任务停止同节点的新任务。
结果 `cancellationRequested=true, remoteStoppedConfirmed=false` 只确认本机停止
请求。历史 `failed + stoppedByUser` 对外归一为 `cancelled`，不重写原记录，
不承诺上游取消或退款。

CLI 错误在 stderr 返回 JSON，MCP 工具错误返回对应的结构化内容。
写请求遇到网络超时或连接结果不明时返回 `OPERATION_OUTCOME_UNKNOWN`，
不会自动重试，以免重复提交收费任务。本文后续的生成/素材示例描述命令用途，
不表示当前源码已获得这些权限。本节不改变官网已发布安装包/CLI 的行为。

### 结构化操作

```bash
node bin/starcanvas.mjs operation submit --json '{"operation":"projects.list","arguments":{},"idempotencyKey":"example-projects-0001"}'
node bin/starcanvas.mjs operation submit --json '{"operation":"canvas.read","projectId":"default","arguments":{"scope":"selected","includeContent":false},"idempotencyKey":"example-canvas-read-0001"}'
node bin/starcanvas.mjs operation get REQUEST_ID --receipt RECEIPT
node bin/starcanvas.mjs operation cancel REQUEST_ID --receipt RECEIPT
```

也可以用 `STARCANVAS_OPERATION_RECEIPT` 环境变量传递单个请求的 receipt，
避免写进命令历史。receipt 是临时结果访问凭据，勿共享、写日志或提交到仓库。
MCP 对应 `starcanvas_submit_operation`、`starcanvas_get_operation`、
`starcanvas_cancel_operation`，旧工具和 `wanjuan_` 别名保留。

可提交操作：`app.status`、`app.preferences.read/set`、`app.navigate`、
`models.list`、`tasks.list/get`、`projects.list`、
`canvas.read`、`canvas.plan.preview/apply/undo`、`canvas.generation.preflight`。
`canvas.read.release` 用 `{ticketId}` 释放未确认读取及关联预览，
`canvas.plan.release` 用 `{planId}` 释放未执行预览，不删除已执行的撤销凭据。
读取释放也回收已完全撤销的关联方案；仍处于已应用状态的方案继续保留，
不会因关闭预览丢失可用撤销或失效检查。活跃方案和任务仍有容量限制。
`preview` 的 arguments 为 `{ticketId,proposal}`；`apply/undo/preflight` 为
`{planId}`。proposal 使用现有 version=1 的结构化画布计划。读取默认仅选中
范围的结构；`scope=structure` 显式扩大结构范围；`includeContent=true` 会等待
App 的一次性文字分享确认，不会返回媒体地址或完整配置。项目列表仅含 ID
和当前项目标识，不返回项目名称。参数不支持任意路径、URL、命令或权限字段。

提交返回 `{request,receipt,replayed}`。`request.status` 区分 `preparing`、
`awaiting_confirmation`、`queued`、`running`、`completed`、`failed`、
`rejected`、`cancelled`、`expired`、`outcome_unknown`。提交成功或确认排队不等于
执行完成；只根据对应 request 的实际结果判断。相同 idempotencyKey 与完全相同
请求返回首次身份，改变内容则拒绝；客户端不自动重试写请求。
`outcome_unknown` 是观察超时或提交不确定，不表示已取消/失败；后续真实结果
可以更新同一个请求。执行开始后的取消返回 `OPERATION_TOO_LATE`。

请求、方案及授权仅在当前 App 内存中存活，最长十分钟；App 重启不恢复
执行授权。结果过期不允许自动重新执行。服务有显式容量上限，返回
`OPERATION_LIMIT` 时不能绕过限制重复制造请求。HTTP 仅有提交、按 receipt
查询和取消，没有批准或全局结果列表接口。所有窗口审批及 nonce 消费都需
通过可信 App IPC；字段 `confirmed`/`permissions` 不能授权。

macOS 与 Windows 安装版已验证 CLI/MCP 连接、画布确认、角色和历史升级保留，
以及本地模拟服务的图片、通用视频、天玑提交/轮询/结果保存与重启恢复。
七主题和三语言界面已检查。观察超时保留原任务，迟到结果不会自动重复提交。
所有生成验收使用隔离资料与本机模拟服务，不承诺全部上游服务、真实计费或远端取消。

## 独立下载

当前版本：`1.4.9`。配套归档：[starcanvas-cli-1.4.9.zip](https://github.com/Guan-XX003/StarCanvas/releases/download/v1.4.9/starcanvas-cli-1.4.9.zip)。

CLI/MCP 可以单独解压，不需要放在 App 安装目录内，但调用时仍需要桌面应用正在
运行。请使用与 App 同版本的工具包，不要混用旧版客户端。

压缩包只包含 CLI/MCP 程序与本说明，不包含账号会话、API Key 或用户数据。

StarCanvas启动后会在当前用户数据目录创建一次性本机自动化凭据。CLI 和 MCP 只连接 `127.0.0.1`，不会读取或输出模型 API Key、账号 Token 或完整应用配置。

## 使用条件

- StarCanvas桌面 App 必须正在运行，并且画布已经加载完成。
- 外部运行 CLI/MCP 需要 Node.js 18 或更高版本。
- 每次 App 启动都会生成新的随机 bearer token；异常退出留下的旧凭据会在下次启动时清理，CLI 也会自动跳过死进程、旧端口和失效鉴权。

## 正式版位置

CLI/MCP 作为真实文件随安装包放在 `resources/starcanvas-cli`，不会只存在于 `app.asar` 中。

macOS：

```bash
node "/Applications/StarCanvas.app/Contents/Resources/starcanvas-cli/starcanvas.mjs" status
```

Windows：在StarCanvas安装目录下使用：

```powershell
node ".\resources\starcanvas-cli\starcanvas.mjs" status
```

源码开发目录中可以使用：

```bash
npm run starcanvas -- status
npm run starcanvas -- models
npm run starcanvas -- tasks
```

旧版 `wanjuan` / `wanjuan-mcp` 命令与 `resources/wanjuan-cli` 路径暂时保留为兼容别名；新配置统一使用 StarCanvas 名称。

## CLI 命令

提交图片任务：

```bash
npm run starcanvas -- image generate \
  --prompt "一只在月球散步的橘猫，电影感光影" \
  --model "gpt-image-2" \
  --size "1024x1024"
```

参考图生图增加 `--reference /绝对路径/图片.png`。本地参考图片必须是存在的普通文件且不超过 100MB；远程图片只接受 `http` 或 `https` URL。

提交图生视频任务：

```bash
npm run starcanvas -- video generate \
  --prompt "镜头缓慢推进，猫咪抬头看向星空" \
  --model "wan2.7-i2v-flash-720P" \
  --image "/绝对路径/输入图片.png" \
  --resolution "1280x720" \
  --duration 5
```

提交即梦天玑专用任务：

```bash
npm run starcanvas -- tianji generate \
  --prompt "首帧人物转头看向镜头" \
  --mode first-frame \
  --image "/绝对路径/首帧.png" \
  --resolution 720p \
  --duration 5 \
  --ratio 16:9
```

已审核天玑人像使用专用参数：

```bash
npm run starcanvas -- tianji generate \
  --prompt "镜头缓慢推进" \
  --mode reference-media \
  --portrait-asset-id '<final-active-id>'
```

`--mode` 支持 `text-to-video`、`first-frame`、`first-last`、`reference-media`。`--image` 可重复 9 次，`--video` 和 `--audio` 可各重复 3 次。`--portrait-asset-id` 只接受天玑素材库返回的最终 Active 素材 ID，只能用于 `reference-media`，并与 `--image` 合计最多 9 个；普通 `--image` 不能传 `asset://`。该命令创建真正的即梦天玑节点，并沿用 App 内的极鑫配置，不接受或输出 API Key。

生成命令先返回待审批操作及 receipt，不立即返回 `nodeId`；审批且提交完成后
从操作结果取得 nodeId。以下命令接受完整 `taskId` 或可唯一定位的该 `nodeId`：

```bash
npm run starcanvas -- task get automation-video-...
npm run starcanvas -- task wait automation-video-... --timeout 600
npm run starcanvas -- task cancel automation-video-...
```

参数/配置预检失败在操作状态中返回明确拒绝；提交结果不明不能当成生成失败。
`task wait` 只观察本地记录，不自动重试或推测上游结束；未知结果可能等到超时。

## MCP Server

### 独立包与版本检查

将匹配 App 的 `starcanvas-cli-版本.zip` 解压到自己的工具目录；可以放在源码目录以外。
保留包内全部 `.mjs`、`VERSION.txt` 和 README，不要只复制两个入口文件。
它使用 Node.js 18+，不需要 npm install，不携带或要求模型 Key。

```bash
node /absolute/starcanvas-cli/starcanvas.mjs --version
node /absolute/starcanvas-cli/starcanvas.mjs status
```

`--version` 与 MCP `initialize.result.serverInfo.version` 都读取同一份 `VERSION.txt`。
App 自动化协议版本 **2** 与 MCP stdio 协议 **2025-06-18** 是不同层级，不应混为一谈。
当前 MCP 固定协商实际支持的 2025-06-18；未知版本不会被原样回显为已支持。
客户端应检查协商结果；不支持返回版本时断开。工具请求须在 initialize 回应后发送
`notifications/initialized`，未完成握手返回明确错误且不访问 App。
不宣称支持 2026 per-request discovery；`server/discover` 返回 Method not found，供客户端
按其自身兼容策略回退。参见 [MCP 生命周期与版本协商](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)。

隔离候选或多个 App 实例请显式指定正确实例的 descriptor，避免误连正式应用：

```json
{
  "mcpServers": {
    "starcanvas-candidate": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/starcanvas-cli/starcanvas-mcp.mjs"],
      "env": {
        "STARCANVAS_AUTOMATION_FILE": "/absolute/candidate-profile/starcanvas-automation.json"
      }
    }
  }
}
```

Windows 使用对应 `.exe` 和反斜杠转义后的绝对路径。这里只提供配置示例，不自动改写
Codex、Claude Code 或其他 Agent 的配置。descriptor 包含短期本机鉴权信息，请勿粘贴其内容。
App 重启会更换端口/Token，客户端每次读取 descriptor，不把旧凭据写进 Agent 配置。
移动工具目录后更新入口绝对路径；App 未启动、旧端点、协议不兼容应先检查连接，不能重发
结果不明的生成或写入。CLI/MCP 的连接成功不授予任何额外画布、上传或收费权限。

源码目录启动：

```bash
npm run starcanvas:mcp
```

正式 macOS 安装包配置示例：

```json
{
  "mcpServers": {
    "starcanvas": {
      "command": "node",
      "args": [
        "/Applications/StarCanvas.app/Contents/Resources/starcanvas-cli/starcanvas-mcp.mjs"
      ]
    }
  }
}
```

Windows 将 `args` 改为安装目录下 `resources\\starcanvas-cli\\starcanvas-mcp.mjs` 的绝对路径。

MCP 工具：

- `starcanvas_status`
- `starcanvas_list_models`
- `starcanvas_list_tasks`
- `starcanvas_generate_image`
- `starcanvas_generate_video`
- `starcanvas_generate_tianji_video`
- `starcanvas_get_task`
- `starcanvas_wait_task`
- `starcanvas_cancel_task`

MCP 的 `starcanvas_generate_tianji_video` 提供等价的 `portraitAssetIds` 数组。该字段走严格的已审核人像通道，不能由普通 `images` 或任意 `asset://` 字符串替代。

MCP Server 的 stdout 只输出 JSON-RPC 消息；工具错误作为 MCP 结果返回。

## 当前覆盖范围

当前源码覆盖状态、图片/视频/文本模型列表、统一任务列表/查询/等待、受控画布计划、
基础设置/导航，以及逐次审批的文生图、通用文生视频、天玑文生视频和本地停止。
素材输入、参考编号、旧路径/URL 分步申请、天玑人像 ID 核验和单条结果导出
已接入相同授权底座。源码窗口覆盖实际图片、通用视频、天玑上传/人像流程；
四种天玑模式的公共字段及媒体形态有实际 hook 回归，不等于四种真实上游验收。

`task get` / `task wait` 不再隐式提取或保存 `customResultData` 的素材，
不返回远程、blob/data 或本地文件路径。结果文件须通过上述独立导出审批；
生成素材输入须经过上述范围授权，不能凭路径/URL 字符串自行读取。

当前尚未覆盖：文本生成、音频/TTS/音乐、通义专用节点、天玑人像组创建/认证管理、
任意节点或任意设置修改、项目导入导出、媒体编辑和账号操作。
已接通的节点/连线修改限于上述结构化计划与支持范围，不能执行任意 Electron IPC。

## 安全边界

- 服务固定监听 `127.0.0.1`，不开放局域网或公网端口。
- bearer token 每次启动随机生成，凭据文件限制为当前用户访问。
- App 启动和退出都会尽力清理旧凭据。
- 素材路径/URL 字符串不等于访问授权；未开放的输入及任意文件导出仍拒绝，任务结果须逐次审批。
- 请求体限制为 2MB；参考图片文件限制为 100MB。
- 生成操作可能产生费用，应用端要求逐次审批及费用确认，不能由 Agent 请求字段授权。
- 当前读取权限只返回任务元数据，不返回提示词或结果地址；不要共享自动化凭据文件。

### 从已搭建的方案生成

`operation submit` / `starcanvas_submit_operation` 新增 `canvas.plan.generate`，
arguments 只接受 `planId`、`nodeId`，并须提供该方案的 `projectId` 和新的
`idempotencyKey`。只能使用同一调用方已经执行的方案及其影响范围内的图片/视频
生成节点；不能传提示词、路径、URL、模型或确认标志来绕过画布预览。

App 会重新显示当前有效提示词、参数和精确素材节点，并单独确认发送内容及本次
可能产生的费用。初次生成沿用方案节点，保留原结果的再次生成创建新分支。
返回 `generationStarted:true, generationCompleted:false` 只说明本机开始提交，
不代表上游受理、生成完成或结果已经保存。用返回的 nodeId 查询原任务；观察失败
不能自动换 idempotencyKey 重发。同一键只查询/重放原请求身份。

此功能需要 1.4.9 App 与匹配工具包；旧便携客户端不具备该能力。

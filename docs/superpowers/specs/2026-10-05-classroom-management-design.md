# 课堂管理功能 · 设计文档

> 版本：v1.0 · 日期：2026-10-05 · 状态：设计已分节确认（含浏览器原型逐页确认），待评审
> 前置：在线打字练习系统 v1.0（`2026-09-26-online-typing-system-design.md`）

---

## 1. 概述与范围

### 1.1 一句话定位

在现有打字练习系统上新增教师课堂管理能力：**课次考勤、通用作业、课堂公告、表现积分、综合报表**，五者作为一个「课堂管理」功能集分期交付，与打字主线（task/record/heartbeat）并存互不干扰。

### 1.2 核心用户故事

| 角色 | 新增主线流程 |
|---|---|
| 教师 | 开课 → 盯实时考勤（登录自动打卡 + 在座辅助）→ 修正病假/事假/旷课 → 结课（自动全勤加分）；布置作业（文本+附件）→ 批改打分点评；发普通/积分通报公告；手动加扣分；导出班级课堂报表 |
| 学生 | 上课登录即自动打卡；查看/提交作业（截止前可重交）；查看批改结果；浏览本班公告；个人中心查看自己的积分流水与总分 |
| 超管 | 不新增操作（公告仅教师可发，v1 无全校广播）；报表可查看所有班级 |

### 1.3 明确不做（v1 范围外）

- 全校课表/排课实体（课次仅教师手动开关）
- 超管全校公告、学生端常驻积分排行榜、公告已读回执
- 积分规则可配置（固定常量）、座位表管理
- 作业附件在线预览（仅下载）

### 1.4 约束（继承原系统）

校内局域网单机部署、无外网依赖；MySQL utf8mb4；教师 ~20 人、学生 ~1500 人；不引入 WebSocket；每日 mysqldump 备份、日志按天滚动。

---

## 2. 架构决策

**方案 A：现有单体扩模块**（已确认，方案 B 微服务 / 方案 C 改造现有实体均被否）。

- server 新增 5 个 NestJS 模块：`sessions`（课次+考勤）、`homework`（作业+提交+附件）、`announcements`、`points`、`reports`。
- 现有 6 张表零改动；新增 7 张表（§4）。
- 复用：JWT + `@Roles` 守卫、Service 层资源归属校验、统一响应体 `{code,message,data}`、分页约定、CSV 导出（UTF-8 BOM）模式、heartbeat 60s 在线窗口。
- **唯一新增后端依赖**：`@nestjs/schedule`（每分钟结算扫描，§5.5）。
- 新增后端 `platform-express` 自带的 `FilesInterceptor`（multer）处理 multipart，无额外依赖。
- 前端：教师端菜单新增可展开父项「课堂管理」收纳 5 个新页面（原型方案 B）；学生端菜单新增「我的作业」「班级公告」，积分并入个人中心；admin 端无新增页面（报表复用现有 Overview 扩展入口即可，见 §7.3）。

考勤与 heartbeat 的关系是**只读辅助**：heartbeat 不改变考勤记录，仅在考勤表提供"当前在座"灰/绿点参考，避免学生中途起身被误判缺勤。

---

## 3. 角色权限增量

| 能力 | teacher | student | admin |
|---|---|---|---|
| 开课/结课/修正考勤 | 仅本人班级 | — | 只读 |
| 布置/批改/关闭作业 | 仅本人班级 | 提交本人班级作业 | 只读 |
| 发布公告 | 仅本人班级 | 查看本班已发布 | —（v1 不可发） |
| 手动加扣分 | 仅本人班级学生 | — | — |
| 查看积分 | 本班学生总分+流水 | 仅本人流水+总分 | 全部只读 |
| 课堂报表 | 本人班级 | — | 全部班级 |

归属校验全部在 Service 层，沿用现有模式（教师访问他人班级 → 403）。

---

## 4. 数据库设计（新增 7 张表）

所有表 utf8mb4、自增 id、DATETIME 时间字段，风格与现有 6 表一致。

### 4.1 class_session — 课次表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| class_id | INT | FK → class.id |
| teacher_id | INT | FK → users.id；创建时冗余，便于校验 |
| period | VARCHAR(20) NULL | 第几节，自由文本（如"第三节"），可空 |
| status | ENUM('open','closed') | 同一班级同时仅一个 open（Service 层校验，409） |
| started_at / ended_at | DATETIME / DATETIME NULL | 开/结课时间 |

索引：(class_id, status)、(teacher_id, started_at)。

### 4.2 attendance — 考勤表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| session_id | INT | FK → class_session.id |
| user_id | INT | FK → users.id |
| check_in_at | DATETIME NULL | 首次自动打卡时间 |
| status | ENUM('absent','present','late','excused','sick') | 开课生成时全部 absent |
| corrected | TINYINT(1) | 教师修正后置 1，自动打卡不再覆盖 |
| note | VARCHAR(200) NULL | 修正备注 |

唯一键 (session_id, user_id)。开课事务内按班级学生批量生成 absent 行。
状态语义：absent=未打卡(旷课)、present=到课、late=迟到、excused=事假、sick=病假。

### 4.3 homework — 作业表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| class_id | INT | FK → class.id |
| title | VARCHAR(200) | |
| content | TEXT | 作业要求，学生端原样展示 |
| due_at | DATETIME | 截止时间 |
| allow_attachment | TINYINT(1) | 0 时提交页隐藏附件区 |
| status | ENUM('published','closed') | closed=已截止（手动或 cron 自动） |
| created_by | INT | |

索引：(class_id, status)。

### 4.4 homework_submission — 作业提交表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| homework_id / user_id | INT | FK；唯一键 (homework_id, user_id) |
| text_content | MEDIUMTEXT | 文本回答 |
| submitted_at | DATETIME | 最后一次提交时间 |
| is_late | TINYINT(1) | 服务端按 submitted_at > due_at 判定 |
| score | DECIMAL(5,2) NULL | 教师评分（0–100） |
| teacher_comment | VARCHAR(500) NULL | 点评，学生可见 |
| graded_by / graded_at | INT NULL / DATETIME NULL | |

### 4.5 homework_file — 作业附件表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| submission_id | INT | FK；索引 |
| original_name | VARCHAR(255) | 下载时回显 |
| stored_key | VARCHAR(255) | UUID 重命名后的存储文件名 |
| mime_type | VARCHAR(100) | 仅记录，不作信任依据 |
| size_bytes | INT | |

### 4.6 announcement — 公告表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| class_id | INT | FK → class.id（仅发本班） |
| title / content | VARCHAR(200) / TEXT | |
| type | ENUM('general','points') | points=积分通报（正文含排行快照，§5.4） |
| status | ENUM('published','offline') | 下架后学生端隐藏 |
| created_by | INT | |

### 4.7 point_record — 积分流水表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| user_id | INT | FK → users.id |
| delta | INT | 正加负减 |
| reason | VARCHAR(200) | 手动必填；自动由系统生成描述 |
| source | ENUM('manual','auto_attendance','auto_homework','auto_typing') | |
| ref_id | INT NULL | 来源记录 id：auto_attendance→session_id，auto_homework→homework_id，auto_typing→record_id；manual 为 NULL |
| created_by | INT NULL | NULL=系统自动 |
| created_at | DATETIME | |

唯一键 (source, ref_id, user_id) —— 自动得分幂等防重的核心约束（MySQL 唯一键允许多行 NULL，manual 不受影响）。学生总分 = SUM(delta)，无冗余总分表。

---

## 5. 核心业务流程

### 5.1 考勤：开课 → 打卡 → 结课

```
开课   POST /sessions → 校验该班无 open 课次(409) → 事务：建 session + 按班级批量插 attendance(absent)
打卡   auth.login 成功后进程内直调 SessionsService.tryClockIn(userId)（仅 role=student 触发）：
       该生班级有 open 课次 且 该行未 corrected 且未打过卡
       → 写 check_in_at，status = present（开课≤5分钟）/ late（>5分钟）
       学生无感知：无 open 课次时直接返回，不产生任何请求开销以外的行为
       同一 tryClockIn 亦在 heartbeat 上报时调用（覆盖"上课前已登录、开课瞬间在线"的学生，
       最迟 20s 内补打卡；开课即在线者计 present/late 按首次实际打卡时间判定）
在座   考勤列表查询 LEFT JOIN heartbeat，60s 窗口内在座亮绿点（只读辅助，不改考勤状态）
结课   PATCH /sessions/:id/close → status=closed + ended_at
       → 全勤结算：全班 status=present（不含 late）者写 auto_attendance +5（幂等）
修正   PATCH /attendance/:id → status(excused/sick/late/absent/present) + note，corrected=1
```

迟到阈值 5 分钟、全勤 +5 分为代码常量（`LATE_THRESHOLD_MINUTES=5`、`POINT_ATTENDANCE=5`），调整需改码不需迁移。

### 5.2 作业：布置 → 提交 → 批改

```
布置   教师 POST /homeworks（标题/要求/班级/截止时间/附件开关）
提交   学生 POST /homeworks/:id/submissions（multipart：textContent + files[]）
       校验：本班学生、published、单文件≤10MB、≤3 个、扩展名白名单(jpg jpeg png pdf doc docx zip)
       落盘流程：multer 先写 staging 目录 → DB 事务(覆盖旧提交:删旧行旧文件+插新) 提交成功
       → rename 到正式目录；失败则清理 staging，绝不产生"有记录无文件/有文件无记录"
       截止前重复提交整体覆盖，以最后一次为准；截止后提交接受但 is_late=1（补交）
批改   教师 PATCH /submissions/:id/grade {score, comment}，可反复修改，记录 graded_by/at
下载   GET /files/:id/download：JWT + 归属校验(提交者本人/该作业教师/admin) → 流式输出
       Content-Disposition 用 original_name 编码回显；uploads 不在 Nginx 静态目录内
```

存储路径：`/var/www/typing/uploads/homework/<yyyy-mm>/<uuid>.<ext>`。

### 5.3 积分：手动 + 三类自动

| 来源 | 触发点 | 分值（常量） | ref_id |
|---|---|---|---|
| auto_attendance | 结课 | 全勤 +5 | session_id |
| auto_homework | 作业截止结算 | 按时提交 +2（is_late=0） | homework_id |
| auto_typing | 交卷事务成功后 isPassed=true | 达标 +5 | record_id |
| manual | 教师弹窗（支持批量学生、正负分、必填理由） | 自定义 | NULL |

学生端仅见自己流水与总分；无班级排行页。

### 5.4 公告与积分通报

教师发布时选 `type=points` 且 `attachRanking=true` → 服务端取本班当前 `SUM(delta)` 前 10 名，拼接"截至 X 日 X 时"快照文本追加至 content 落库（快照制，发布后排行不随数据变化）。普通公告同流程，无排行附件。

### 5.5 结算调度（@nestjs/schedule）

每分钟（`CronExpression.EVERY_MINUTE`）扫描：
1. `status='published' AND due_at < NOW()` 的作业 → 置 closed + 按时提交者 +2（auto_homework，幂等）。
2. 超过 4 小时仍 open 的课次不自动关闭（机房拖堂常见），仅在教师端页面标记提醒。

结算依赖唯一键防重，天然可重跑；服务重启后下一轮自动补扫。

### 5.6 报表

`GET /reports/class/:classId?from=&to=`：区间内按课次聚合出勤率（到/迟/缺人次）、作业提交率（应交/实交/迟交/未交）、打字达标率与均速（复用 record 表）、积分净增（分手动/自动/扣分），并返回每生明细行；`export=csv` 走现有 BOM 模式。

---

## 6. API 设计（新增 20 端点）

约定同现有系统：`/api` 前缀、JWT、统一响应体、`?page=&pageSize=` 分页、401/403/409 语义。

### sessions（5）
| 方法 | 路径 | 角色 |
|---|---|---|
| POST | /api/sessions | teacher |
| PATCH | /api/sessions/:id/close | teacher |
| GET | /api/sessions?classId=&page= | teacher/admin |
| GET | /api/sessions/:id/attendance | teacher/admin |
| PATCH | /api/attendance/:id | teacher |

### homework（8）
| 方法 | 路径 | 角色 |
|---|---|---|
| POST | /api/homeworks | teacher |
| PATCH | /api/homeworks/:id | teacher（编辑/关闭） |
| GET | /api/homeworks | teacher/admin（本班过滤）；student（本班 published+closed，closed 显示"已截止"供补交/回看） |
| GET | /api/homeworks/:id | 按角色返回详情/统计/本人提交 |
| POST | /api/homeworks/:id/submissions | student（multipart） |
| PATCH | /api/submissions/:id/grade | teacher |
| GET | /api/homeworks/:id/grades?export=csv | teacher/admin |
| GET | /api/files/:id/download | 提交者本人/该作业教师/admin |

### announcements（3）
| 方法 | 路径 | 角色 |
|---|---|---|
| POST | /api/announcements | teacher |
| GET | /api/announcements | teacher/admin/学生（本班过滤） |
| PATCH | /api/announcements/:id | teacher（下架/恢复/编辑） |

### points（3）
| 方法 | 路径 | 角色 |
|---|---|---|
| POST | /api/points | teacher（{userIds[], delta, reason} 批量） |
| GET | /api/points/mine | student |
| GET | /api/points/students?classId=&page= | teacher/admin |

### reports（1）
| 方法 | 路径 | 角色 |
|---|---|---|
| GET | /api/reports/class/:classId?from=&to=&export=csv | teacher（本班）/admin |

打卡不设 HTTP 端点（登录进程内直调），学生无额外请求。

---

## 7. 页面原型（已通过可视化逐页确认）

线框稿存于 `.superpowers/brainstorm/4565-*/content/`（已 gitignore），以下为结论性描述。

### 7.1 导航结构（原型方案 B）

- 教师端：现有 6 菜单项不动，新增可展开父项「课堂管理 ▾」→ 开课考勤 / 作业管理 / 公告通知 / 表现积分 / 课堂报表。
- 学生端：新增「我的作业」「班级公告」菜单项；「我的积分」并入个人中心。

### 7.2 教师端页面

- **开课考勤**：顶部开课状态条（班级+节次选择、开课/结课按钮、已上时长）；中部考勤表（姓名、打卡时间、在座●/○、考勤状态、修正操作，缺勤行提供 病假/事假/旷课 快捷修正）；下部历史课次表（到/迟/缺人次，点击查看当日名单）。
- **作业管理**：列表页（标题/班级/截止/提交数/待批改数/状态/操作，筛选班级与状态）+ 布置弹窗（标题、要求多行文本、班级、截止、附件开关）+ 批改页（左提交列表含按时/迟交/已批/未交态，右正文预览+附件+分数+点评保存）。
- **公告通知**：发布弹窗（标题、类型单选 普通/积分通报、班级、正文、"附本班积分排行快照"复选）+ 列表（类型徽章、下架/恢复）。
- **表现积分**：班级筛选 + 加扣分弹窗（学生搜索多选、分值正负、理由）+ 学生分组总分表（展开流水；页头展示自动规则说明）。
- **课堂报表**：班级+区间选择、四张汇总卡（出勤率/提交率/达标率/积分净增）、每生明细表、导出 CSV。

### 7.3 学生端与超管

- **我的作业**：卡片列表——进行中（剩时提醒、去做作业）、已批改（得分+点评）、已错过（未提交红色态）。
- **作业提交页**：顶部作业要求原文与截止提示、正文文本域、附件区（allow_attachment 时显示）、提交按钮、"截止前可重交以最后一次为准"说明。
- **班级公告**：列表（类型徽章+时间+教师名）点开看正文；积分通报含排行快照文本。
- **个人中心·我的积分**：当前总分数卡 + 流水表（时间/±/说明），注明不展示班级排名。
- **超管**：v1 不给超管新增独立页面；现有 Overview 页加一张「课堂报表」跳转卡，进入与教师端同款报表页（admin 角色可查任意班级）。

---

## 8. 错误处理与安全

- **上传**：multer limits 单文件 10MB/次 3 个；扩展名白名单服务端校验（不看 mime 猜类型）；UUID 重命名存储，杜绝路径穿越与执行类扩展；文件存于 Nginx 静态根之外，仅经鉴权接口流式下载。
- **状态机守卫**：closed 课次拒绝打卡与修正（409）；closed 作业仍可补交（标 is_late）但不可再批改关闭。
- **归属**：所有新端点 Service 层校验班级归属，模式同现有 classes/records。
- **并发**：开课唯一 open 用部分校验+事务；积分唯一键防自动重复；提交覆盖用事务+staging 补偿删除。
- **备份增量**：backup.sh 增加 uploads 目录同步打包（mysqldump 仅覆盖 DB）；日志沿用现有 /var/log/typing。
- **输入**：沿用 class-validator DTO；text_content 长度上限 50000 字符；公告正文 10000。

---

## 9. 测试策略

- **Service 单测（vitest，沿用 server 现有模式）**：tryClockIn 四种边界（无 open 课次/已 corrected/阈值内/阈值外）、结课全勤结算幂等、作业 late 判定、staging 失败清理、积分快照生成 topN、报表聚合口径。
- **Controller e2e（supertest，沿用现有 e2e 配置）**：开课 409、非归属教师 403、multipart 提交（含超限 413/非法类型 415）、下载鉴权、CSV BOM 头。
- **前端（沿用 web vitest + @vue/test-utils）**：作业列表状态渲染、提交页附件开关、积分流水格式化、考勤修正弹窗。
- **验收脚本**：用 seed 数据跑通 开课→登录打卡→修正→结课→布置作业→附件提交→重交覆盖→批改→截止 cron→积分核对→报表导出 全链路。

---

## 10. 分期建议（实施计划输入）

| 期 | 内容 | 依赖 |
|---|---|---|
| P1 | 迁移 7 表 + sessions/attendance（含登录挂钩、结课全勤分）+ 教师考勤页 | — |
| P2 | homework（含上传/批改/cron 按时分）+ 教师作业页 + 学生作业两页 | P1（cron 基建） |
| P3 | points 手动/查询 + 积分页（师生）+ 公告（含积分快照） | P1/P2 自动分数据 |
| P4 | reports + 导出 + 学生个人中心积分区 | P1–P3 |

每期独立可部署可回滚，符合单机灰度（先一个班试用）需求。

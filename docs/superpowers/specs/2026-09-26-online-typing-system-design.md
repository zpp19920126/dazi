# 在线打字练习系统 · 设计文档

> 版本：v1.0 · 日期：2026-09-26 · 状态：设计已分段确认，待开发

---

## 1. 项目概述

### 1.1 一句话定位

面向学校教学场景的 BS 架构在线打字练习网站：支持中文（网页内拼音输入）与英文打字训练，教师可创建班级、批量生成学生账号、发布打字任务并实时监督；超管统一管理教师账号与全局文章库。

### 1.2 核心用户故事

| 角色 | 主线流程 |
|---|---|
| 超管 admin | 登录 → 生成/管理教师账号 → 维护全局文章库（下架/恢复）→ 查看系统概览 |
| 教师 teacher | 创建班级 → 批量生成学生账号 → 自建/选用文章 → 发布打字任务 → 实时看板监督 → 成绩查询与 CSV 导出 |
| 学生 student | 首次登录改密 → 查看本班任务 → 在线打字练习（实时速度/准确率）→ 交卷 → 查看个人成绩 |

### 1.3 规模与约束

- 部署环境：校内局域网，单台 Linux 服务器，无外网依赖
- 用户规模：教师约 12–20 人，学生约 1000–1500 人
- 心跳压力估算：单班 15 人同时练习 ≈ 15 请求/秒；全校 1300 学生同时在线 ≈ 65–75 请求/秒，单服务器轻松承载
- 数据安全：每日凌晨自动备份数据库，日志按天滚动

---

## 2. 技术选型（方案 A，已确认）

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Vue 3 SPA（Vite 构建 + Vue Router + Pinia） | 单页应用，三角色共用一套登录入口，按角色路由守卫分流 |
| UI 组件 | Element Plus | 表格/表单/弹窗密集的管理端风格 |
| 后端 | Node.js + NestJS（单体） | 8 个业务模块单仓单服务，PM2 进程守护 |
| ORM | Prisma | schema 即文档，迁移可追溯 |
| 数据库 | MySQL 8.0（utf8mb4） | 中文必需；仅监听 127.0.0.1 |
| 认证 | JWT（有效期 7 天）+ bcrypt 密码哈希 | 无状态，单机无需 session 存储 |
| 反代/托管 | Nginx | 80 端口：`/` 托管 Vue dist 静态资源，`/api/*` 反向代理到 NestJS(3000) |
| 实时方案 | 本地 500ms 前端刷新 + 学生端 20s 心跳上报 + 教师端 30s 轮询 | 不引入 WebSocket，降低复杂度（方案 C + 心跳） |

**中文输入方案**：网页内自实现拼音输入法候选条；监听 `composition` 事件族，**仅 `compositionend` 上屏的汉字计入统计**，避免拼音字母污染速度/准确率计算。英文直接按字符比对。

---

## 3. 角色与权限模型

| 角色 | 可做 | 不可做 |
|---|---|---|
| admin | 教师/学生账号的全局生成与管理、全局文章库（内置文章可编辑、教师自建文章全员可见、可下架/恢复）、系统概览 | 不参与日常教学操作 |
| teacher | 班级 CRUD、本班学生账号批量生成与重置/停用、自建文章（仅本人可见可改）、发布/编辑任务、实时看板、本班成绩查询与导出 | 访问他人班级与其他教师文章 |
| student | 查看本班任务、打字练习与交卷、查看个人成绩、修改密码 | 任何管理操作 |

**资源归属校验**：统一在 NestJS Service 层校验（教师只能操作自己班级/文章/任务），不依赖前端隐藏入口。

**账号状态**：`status = active / disabled`；停用后登录被拒。**删除保护**：有关联班级/学生的教师只能停用、不能物理删除。

**首次登录强制改密**：`must_change_password = 1` 时登录成功后强制跳转修改密码页，改完才能进入业务页面。

---

## 4. 数据库设计（6 张核心表）

所有表使用 utf8mb4；主键统一自增 id；时间字段为 DATETIME。

### 4.1 users — 用户表（三角色共用）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| username | VARCHAR(50) UNIQUE | 教师建议 t001…，学生建议 s+学号风格，批量生成自动衔接 |
| password_hash | VARCHAR(100) | bcrypt |
| real_name | VARCHAR(50) | 姓名 |
| role | ENUM('admin','teacher','student') | |
| class_id | INT NULL | 仅学生有值；FK → class.id |
| status | ENUM('active','disabled') | |
| must_change_password | TINYINT(1) | 首次登录强制改密 |
| created_by | INT NULL | 创建该账号的用户 id |
| last_login_at | DATETIME NULL | |
| created_at | DATETIME | |

### 4.2 class — 班级表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| name | VARCHAR(100) | 如「三年级2班」 |
| teacher_id | INT | FK → users.id；一个教师可建多班 |
| created_at | DATETIME | |

### 4.3 text — 文章表（全局库 + 教师自建共用）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| title | VARCHAR(200) | |
| language | ENUM('zh','en') | |
| difficulty | TINYINT | 1–5 |
| content | TEXT | 练习文本 |
| char_count | INT | 冗余存储，用于统计与展示 |
| created_by | INT NULL | NULL = 内置文章 |
| status | ENUM('published','offline') | offline = 下架（软删除，可恢复） |
| created_at | DATETIME | |

可见性规则：内置文章所有人可见；教师自建文章仅本人与超管可见；下架后教师端不可选用、学生端同步隐藏。

### 4.4 task — 任务表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| class_id | INT | 单班发布；FK → class.id |
| text_id | INT | FK → text.id |
| title | VARCHAR(200) | |
| mode | ENUM('article','time') | 整篇挑战 / 限时挑战 |
| duration_seconds | INT | time 模式必填；article 模式可空 |
| min_speed | INT | 达标速度线（字/分） |
| min_accuracy | INT | 达标准确率线（%） |
| deadline | DATETIME | 截止时间；教师可提前截止 |
| status | ENUM('published','closed') | |
| created_by | INT | |
| created_at | DATETIME | |

### 4.5 record — 成绩记录表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO | |
| user_id | INT | FK → users.id |
| task_id | INT NULL | NULL = 自由练习 |
| mode | ENUM('article','time') | 冗余记录当时模式 |
| speed | DECIMAL(6,2) | 字/分 |
| accuracy | DECIMAL(5,2) | % |
| total_chars | INT | 总字符（中文按汉字、英文按字符） |
| correct_chars | INT | 正确字符 |
| backspace_count | INT | 退格次数 |
| duration_seconds | INT | 实际用时 |
| is_passed | TINYINT(1) | speed ≥ min_speed 且 accuracy ≥ min_accuracy（自由练习无达标概念，可空） |
| is_suspicious | TINYINT(1) | 速度 > 600 字/分自动标记可疑，成绩保留、教师复核 |
| created_at | DATETIME | |

### 4.6 heartbeat — 实时状态表（每学生一行，UPSERT）

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | INT PK | FK → users.id |
| task_id | INT NULL | 当前练习任务 |
| status | ENUM('typing','paused','finished') | |
| speed | DECIMAL(6,2) | 实时速度 |
| accuracy | DECIMAL(5,2) | 实准确率 |
| progress | DECIMAL(5,2) | 进度 % |
| elapsed_seconds | INT | 已用时 |
| char_index | INT | 当前打到第几个字符 |
| updated_at | DATETIME | 每次心跳覆盖更新 |

**离线判定**：`updated_at` 距今 > 60 秒视为离线。**交卷后**：DELETE 该行，看板状态消失。

---

## 5. 核心业务流程

### 5.1 登录与改密

1. `POST /api/auth/login` 校验账号密码 → 返回 JWT + 用户信息
2. 若 `must_change_password = 1` → 前端强制跳转修改密码页，`POST /api/auth/change-password` 成功后清除标记
3. 前端路由守卫按 role 分流到对应端首页

### 5.2 打字练习与统计口径

- **article 整篇挑战**：文章全文呈现，学生从头打到尾，交卷时结算；计时从第一个按键开始
- **time 限时挑战**：倒计时内打尽量多，时间到自动交卷
- **统计**：本地每 500ms 刷新一次实时速度/准确率展示（纯前端，不发请求）
  - 速度 = 正确字符数 / 分钟（中文按汉字计，英文按字符计）
  - 准确率 = 正确字符 / 已输入字符
  - 退格计入 backspace_count，但不扣分（准确率按最终比对结果）
- **防作弊**：隐藏透明 input 接收输入、禁用粘贴、速度 > 600 字/分标记可疑

### 5.3 心跳与实时看板（无 WebSocket）

```
学生端：本地 500ms 刷新界面 → 每 20s POST /api/heartbeats（UPSERT 自己那行）
教师端：30s 轮询 GET /api/classes/:id/live
        → 读 heartbeat 表 JOIN users，>60s 无心跳标灰为离线
学生交卷：POST /api/records 成功 → DELETE heartbeat 行 → 看板显示"已完成"
```

### 5.4 达标判定

交卷时后端计算：`is_passed = (speed ≥ task.min_speed) && (accuracy ≥ task.min_accuracy)`，双线达标才算通过。

---

## 6. API 设计

### 6.1 通用约定

- 基础前缀 `/api`；统一响应体 `{ code, message, data }`，业务码 0 = 成功
- 认证：除 `POST /api/auth/login` 外全部要求 `Authorization: Bearer <JWT>`（7 天有效）
- 错误语义：401 未登录/token 失效；403 无权限或资源不归属当前用户；409 冲突（如用户名重复、班级非空）
- 分页：`?page=1&pageSize=20`，返回 `{ list, total }`
- Service 层统一做资源归属校验

### 6.2 端点总表（8 模块 · 23 端点）

#### auth（2）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | /api/auth/login | 公开 | 登录，返回 JWT + 用户信息 + must_change_password |
| POST | /api/auth/change-password | 全部 | 修改自己的密码 |

#### users（5）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /api/users/teachers | admin | 教师列表（分页、搜索） |
| POST | /api/users/teachers | admin | 新建教师账号，返回初始密码 |
| GET | /api/users/students | teacher/admin | 学生列表；教师自动过滤为本班（?classId=） |
| POST | /api/users/students/batch | teacher/admin | 批量生成学生账号（姓名列表 → 账号密码表） |
| PATCH | /api/users/:id | admin | 教师重置密码/停用/启用/删除；学生同理由超管或所属教师操作 |

#### classes（4）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /api/classes | teacher | 我的班级列表 |
| POST | /api/classes | teacher | 创建班级 |
| PATCH | /api/classes/:id | teacher | 重命名 |
| DELETE | /api/classes/:id | teacher | 删除；仅允许空班级（409 提示） |

#### texts（6）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /api/texts | 全部 | 文章列表；按 language/status/来源筛选，可见性按角色过滤 |
| GET | /api/texts/:id | 全部 | 文章全文（练习时加载） |
| POST | /api/texts | teacher/admin | 新建文章 |
| PATCH | /api/texts/:id | 作者/admin | 编辑 |
| DELETE | /api/texts/:id | 作者/admin | 删除（仅自建且未被任务引用） |
| PATCH | /api/texts/:id/status | admin | 内置/自建文章下架、恢复 |

#### tasks（3）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /api/tasks | 全部 | 教师=我发布的（含完成率统计）；学生=本班进行中/历史 |
| POST | /api/tasks | teacher | 发布任务 |
| PATCH | /api/tasks/:id | teacher | 编辑、提前截止（closed） |

#### records（3）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | /api/records | student | 交卷；后端计算 is_passed/is_suspicious 并删心跳 |
| GET | /api/records/mine | student | 我的成绩列表 |
| GET | /api/tasks/:id/grades | teacher/admin | 任务成绩单；`?export=csv` 直接导出 CSV |

#### heartbeats（2）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | /api/heartbeats | student | 每 20s 上报，UPSERT |
| GET | /api/classes/:id/live | teacher/admin | 实时看板数据（JOIN heartbeat，含离线判定） |

#### stats（2）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /api/stats/teacher-dashboard | teacher | 工作台汇总（班级数/学生数/进行中任务/平均速度等） |
| GET | /api/stats/admin-overview | admin | 系统概览（教师/学生/班级/累计练习/今日活跃等） |

---

## 7. 页面清单（17 页）

### 共用（3）

| 页面 | 要点 |
|---|---|
| 登录页 | 账号+密码，按角色分流；停用账号提示 |
| 修改密码页 | must_change_password 强制进入；旧密码校验 |
| 404 页 | 未匹配路由兜底 |

### 学生端（4）

| 页面 | 要点 |
|---|---|
| 我的任务 | 本班任务卡片列表：进行中/已截止分组、达标线、我的成绩标记 |
| 打字练习页 | 核心页：文章区+打字区实时比对着色、实时速度/准确率/进度/用时、time 模式倒计时、中文拼音候选条、交卷确认 |
| 我的成绩 | 个人成绩列表：速度/准确率/是否达标/可疑标记 |
| 个人中心 | 班级信息、修改密码入口 |

### 教师端（7）

| 页面 | 要点 |
|---|---|
| 教师工作台 | 汇总卡片（班级/学生/进行中任务/平均速度）+ 最近任务快捷入口 |
| 班级管理 | 班级 CRUD、学生数展示、进入学生管理 |
| 学生账号管理 | 本班学生列表、搜索、批量生成弹窗（姓名粘贴 → 账号密码表可复制）、重置密码/停用 |
| 自建文章库 | 文章列表（仅本人）、新建/编辑弹窗、字符数统计 |
| 任务管理 | 发布任务（选文章/模式/达标线/截止时间）、任务列表含完成率 |
| 任务实时看板 | 30s 轮询：学生状态打字中/暂停/已完成/离线，实时速度与进度条 |
| 成绩查询 | 任务成绩单、达标筛选、CSV 导出、可疑标记复核 |

### 超管端（3）

| 页面 | 要点 |
|---|---|
| 教师账号管理 | 教师列表、新建（初始密码自动生成+首登强制改密）、重置/停用/删除（有关联数据仅停用） |
| 全局文章库 | 全部文章（内置+教师自建）、内置可编辑、下架/恢复 |
| 系统概览 | 只读汇总：教师/学生/班级/累计练习、今日活跃、可疑标记数、服务状态、最近动态 |

---

## 8. 部署架构

### 8.1 拓扑

```
浏览器（教师/学生/超管 共用 Vue SPA）
        │  http://<校内IP>/
        ▼
┌────────── 校内单台 Linux 服务器 ──────────┐
│  Nginx :80                                │
│   ├─ /        → Vue dist 静态资源托管      │
│   └─ /api/*   → 反向代理                  │
│        ▼                                  │
│  NestJS :3000（PM2 守护，8 业务模块）      │
│        ▼                                  │
│  MySQL 8.0（127.0.0.1:3306，不对局域网暴露）│
└───────────────────────────────────────────┘
```

### 8.2 运维机制

- **进程守护**：PM2（崩溃自动重启 + 开机自启），日志按天滚动
- **数据备份**：每日 02:00 crontab 执行 `mysqldump` 到本机备份目录，保留最近 7 份
- **安全基线**：MySQL 仅本机监听；JWT + bcrypt；Service 层归属校验；上传无文件上传功能（无此攻击面）

---

## 9. 已确认的关键设计决策备忘

| # | 决策 | 理由 |
|---|---|---|
| 1 | 单体 NestJS 而非微服务 | 校内单机、规模小，单体最易维护 |
| 2 | 心跳轮询而非 WebSocket | 20s 粒度足够，省去 WS 连接管理与故障排查成本 |
| 3 | 每学生一行 UPSERT 心跳 | 表行数恒定 = 在线学生数，避免表膨胀 |
| 4 | 可疑标记而非拦截 | 成绩保留、教师复核，误杀成本低 |
| 5 | 下架为软删除 | 已发布任务引用的文章不可物理删除 |
| 6 | 中文仅 compositionend 上屏 | 拼音字母不污染统计 |
| 7 | CSV 导出并入 grades 端点 | 减少端点数量，`?export=csv` 切换响应格式 |
| 8 | PATCH /users/:id 合并操作 | 教师/学生的重置、停用、启用、删除共用一个入口，参数区分 |

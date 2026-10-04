# 在线打字练习系统 · 代码分析报告

> 日期：2026-10-05 · 基于 main 分支 commit dfb1194

---

## 1. 项目概览

面向学校教学场景的 B/S 架构打字练习网站（中文拼音输入 + 英文打字训练），部署在校内局域网单台 Linux 服务器上。设计文档见 `docs/superpowers/specs/2026-09-26-online-typing-system-design.md`。

### 1.1 三种角色

| 角色 | 主要功能 |
|---|---|
| admin 超管 | 生成/管理教师账号、维护全局文章库（下架/恢复）、系统概览 |
| teacher 教师 | 班级 CRUD、批量生成学生账号、自建文章、发布打字任务、实时看板监督、成绩查询导出 CSV |
| student 学生 | 首次登录强制改密、查看本班任务、在线打字练习与交卷、查看个人成绩 |

### 1.2 目录结构与技术栈

```
server/  NestJS 12 + Prisma 6 + MySQL 8
         JWT(passport-jwt, 7天) + bcrypt，class-validator
         Vitest 单测/e2e，oxlint
         8 个业务模块：auth / users / classes / texts / tasks
                     / records / heartbeats / stats
         common/：全局异常过滤器 + 响应拦截器，统一 {code, message, data}
web/     Vue 3 + Vite + Pinia + Vue Router + Element Plus + axios + xlsx
         核心：TypingArena.vue / PinyinBar.vue / useTypingEngine / useHeartbeat
         视图按 admin / teacher / student 三端划分，路由守卫按 role 分流
deploy/  Nginx + PM2 + 备份脚本 + 部署手册（Ubuntu / Rocky9 / CentOS7 离线）
docs/    设计文档与实施计划（superpowers/specs、superpowers/plans）
```

### 1.3 关键设计决策

- **无 WebSocket 实时方案**：学生端 20s 心跳 UPSERT 单行，教师端 30s 轮询看板，>60s 判离线，交卷删心跳行。
- **两种练习模式**：`article` 整篇挑战 / `time` 限时挑战；`is_passed` 需速度、准确率双线达标。
- **防作弊**：隐藏透明 input、禁粘贴、失焦/切 tab 合成 paused 状态、速度 >600 字/分服务端标可疑。
- **权限**：Service 层统一做资源归属校验（教师只能操作自己班级/文章/任务），不依赖前端隐藏。
- **规模**：约 1500 学生，心跳峰值 65–75 req/s，单服务器可承载。

### 1.4 当前状态

功能已基本完成并在实际部署。近期提交集中在 CentOS 7 离线部署支持、教师端学生管理（改密/删除/批量删除）、前端构建与依赖锁定修复。

---

## 2. 打字引擎

涉及文件：`web/src/composables/useTypingEngine.ts`、`web/src/components/TypingArena.vue`、`web/src/components/PinyinBar.vue`。

### 2.1 统计口径

中英文统一：`typed` 字符串与 `target` 逐位置比对得 `correctChars`。

- 准确率 = correctChars / typed.length（空输入为 100）
- 速度 = correctChars ÷ (elapsedMs/60000)
- 引擎每 100ms tick 重算（设计文档写 500ms，实现更细；纯本地，不发请求）

### 2.2 输入路径分流（核心设计）

- **英文**：`handleKeydown` 单字符直输；过滤 `e.isComposing / keyCode 229 / key === 'Process'`，避免 IME 拼音过程字符污染统计（useTypingEngine.ts:118）。
- **中文**：走 `compositionend`，且只接受含非 ASCII 字符的 `data`，纯 ASCII 视为拼音过程丢弃（useTypingEngine.ts:138）。

### 2.3 计时语义

- article：从首个有效按键起计时，`typed.length >= target.length` 即 `finish()`。
- time：从引擎创建即开始倒计时（`reset()` 同样重启计时），归零回调 `onTimeout` 自动交卷。

### 2.4 交卷链路（TypingArena.vue:101-143）

- `stats.finished` 被 watch 触发 `doSubmit`（整篇打满自动交卷，不弹确认避免挂起）。
- 手动交卷走 `ElMessageBox` 确认。
- `submitting` + `result` 双重防重；提交 `POST /records` 成功后 `hb.stop()`。
- 自由练习（无 taskId）支持"重新练习"，通过 `engine.reset()` 复位。

### 2.5 防作弊前端侧

1px 透明 input 承接输入（`opacity:0; pointer-events:none`）、`@paste.prevent`、文章 `user-select:none`；点击文章区重新聚焦。

### 2.6 已知小瑕疵

- useTypingEngine.ts:56 三元 `mode==='time' ? elapsedNow() : elapsedNow()` 为无意义残留。
- article 模式 IME 一次上屏多字可使 typed 超出 target 长度（统计循环比对 undefined 不计分，影响很小，未夹紧）。
- **与设计文档的偏差**：文档描述"网页内自实现拼音输入法候选条"，但 `PinyinBar.vue` 目前仅显示当前拼音串的提示条（注释标注 v1 依赖系统输入法上屏），没有自建词库/候选选字。若教学场景要求统一输入法行为，这是下一个迭代的缺口。

---

## 3. 心跳实时看板

涉及文件：`web/src/composables/useHeartbeat.ts`、`server/src/heartbeats/*`、`server/src/records/records.service.ts`、`web/src/views/teacher/LiveBoard.vue`。

### 3.1 数据闭环（无 WebSocket）

```
学生进入练习 → 立即 onTick() 首传 → 每 20s POST /heartbeats（失败静默，不打断练习）
服务端 upsert：heartbeat 表以 userId 为主键，每人仅一行覆盖写
教师看板     → GET /classes/:id/live，30s setInterval 轮询
在线判定     → now - heartbeat.updatedAt < 60s（heartbeats.service.ts:58）
交卷         → $transaction [创建 record, deleteMany heartbeat]（records.service.ts:50-67）
              → 心跳行删除，看板状态消失
```

### 3.2 暂停判定

发送时刻若 `document.visibilityState === 'hidden'` 或窗口失焦（blur），status 合成 `paused`；`finished` 优先不被覆盖。focus/visibilitychange 会重算 away 标记。

### 3.3 服务端校验（不信任前端）

- 提交任务成绩前校验学生班级与任务班级归属 → 403。
- 同任务重复提交 → 409。
- `isPassed` 由服务端用任务 `minSpeed/minAccuracy` 重新计算（双达标）。
- 速度 >600 字/分 → `isSuspicious`，成绩保留、教师复核。
- 看板仅归属教师或 admin 可访问。

### 3.4 成绩单与导出

- JSON 分页附带聚合统计：平均速度、平均准确率、达标率。
- CSV 导出：UTF-8 BOM 前置保证 Excel 中文兼容，字段含"是否达标/可疑"，数字保留 2 位小数（records.service.ts:136-158）。
- 心跳 POST 端点 `@Roles('student')`，看板 GET 端点 `@Roles('admin','teacher')`。

### 3.5 注意点

Prisma Decimal 序列化为字符串，前端统一 `Number(...)` 再格式化。速度/准确率数值本身由客户端上报，服务端只重算派生标志——设计文档接受的取舍，靠可疑标记兜底。

---

## 4. 部署（deploy/）

- **nginx.conf**：80 托管 `/var/www/typing/web-dist`；`/api/` 反代 `127.0.0.1:3000`；`try_files $uri $uri/ /index.html` 支持 Vue Router history 模式。
- **ecosystem.config.js**：PM2 单实例 `typing-api`，`max_memory_restart: 512M`，日志带时间戳落 `/var/log/typing`。
- **backup.sh**：cron 每日 02:00 `mysqldump --single-transaction --no-tablespaces` → gzip，保留 7 天；密码走 `MYSQL_PWD` 环境变量，避免出现在进程列表。
- **README.md（部署手册）**：踩坑实录。Ubuntu 22.04 / Rocky 9 常规在线安装；CentOS 7 因 glibc 2.17 需 Node unofficial-builds（v20.20.2 glibc-217 变体）、MySQL 仅到 8.0.29 el7 rpm bundle、Nginx 1.26 + pcre2 依赖、PM2 需本机整目录打包，全部离线 scp 上传安装。

---

## 5. 总结

| 维度 | 评价 |
|---|---|
| 架构 | 单体 NestJS + SPA，规模匹配（1500 学生），刻意回避 WebSocket，复杂度低 |
| 安全 | JWT + 角色守卫 + Service 层归属校验，删除保护/停用机制齐全 |
| 统计正确性 | IME composition 分流处理严谨，中英文统一口径 |
| 可观测/运维 | 心跳看板 + 每日备份 + PM2 守护 + 按天日志，满足校内场景 |
| 主要缺口 | PinyinBar v2（自实现候选词库）未做；客户端上报数值可信度依赖可疑标记兜底 |

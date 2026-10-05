# 打字练习系统部署手册

目标拓扑：Nginx(80) 静态托管前端 + 反代 `/api/` → Node(NestJS, PM2, 127.0.0.1:3000) → MySQL 8。

目录约定：

- 前端静态产物：`/var/www/typing/web-dist`
- 后端（含 dist/、node_modules/、.env）：`/var/www/typing/server`
- 部署配置：`/var/www/typing/deploy`（本目录）
- 日志：`/var/log/typing`；备份：`/var/backups/typing`

## 1. 环境准备

Ubuntu 22.04：

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
# MySQL 8 / Nginx
sudo apt-get install -y mysql-server nginx
# PM2
sudo npm i -g pm2
sudo mkdir -p /var/www/typing /var/log/typing /var/backups/typing
```

Rocky/RHEL 9（192.168.216.21）：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs mysql-server nginx
npm i -g pm2
mkdir -p /var/www/typing/web-dist /var/www/typing/server /var/www/typing/deploy /var/log/typing /var/backups/typing
systemctl enable --now mysqld nginx
```

CentOS 7 离线（192.168.216.31，yum 源已死且无公网，全部离线包在本机下载后 scp 上传）：

```bash
# --- 本机下载（国内镜像） ---
# Node 20（CentOS 7 glibc 2.17，官方构建不可用，需 unofficial-builds glibc-217 变体）
#   https://registry.npmmirror.com/-/binary/node-unofficial-builds/v20.20.2/node-v20.20.2-linux-x64-glibc-217.tar.xz
# MySQL 8.0.29 el7 rpm bundle（el7 仅到 8.0.29；8.0.29 起 server 多了 icu-data-files 依赖）
#   https://mirrors.huaweicloud.com/mysql/Downloads/MySQL-8.0/mysql-8.0.29-1.el7.x86_64.rpm-bundle.tar
# Nginx 1.26 el7（nginx.org）+ 依赖 pcre2（阿里云 centos-vault）
#   https://nginx.org/packages/centos/7/x86_64/RPMS/nginx-1.26.1-1.el7.ngx.x86_64.rpm
#   https://mirrors.aliyun.com/centos-vault/7.9.2009/os/x86_64/Packages/pcre2-10.23-2.el7.x86_64.rpm
# PM2：tgz 不含依赖，需本机整目录打包（见下）

# --- 服务器安装 ---
# 1) 冲突处理：CentOS 7 自带 mariadb-libs 会与 MySQL rpm 冲突
rpm -e --nodeps mariadb-libs
yum install -y mariadb-libs-compat 2>/dev/null || true   # 若有该包则补上（postfix 等依赖）
# 2) MySQL（bundle 内按序装，common/libs/client/icu-data-files/server）
rpm -ivh mysql-community-{common,libs,client,icu-data-files,server,shared}-8.0.29*.rpm
# 3) Nginx
rpm -ivh pcre2-10.23-2.el7.x86_64.rpm
rpm -ivh nginx-1.26.1-1.el7.ngx.x86_64.rpm
# 4) Node 20（解压到 /usr/local/node，bin 软链到 /usr/local/bin）
tar -xJf node-v20.20.2-linux-x64-glibc-217.tar.xz -C /usr/local/
ln -sfn /usr/local/node-v20.20.2-linux-x64-glibc-217 /usr/local/node
ln -sf /usr/local/node/bin/node /usr/local/bin/node && ln -sf /usr/local/node/bin/npm /usr/local/bin/npm
# 5) PM2（本机打包：npm i -g pm2@7.0.4 --prefix /tmp/pm2global && tar -C /tmp/pm2global -czf pm2-global.tar.gz .）
#    服务器解压注意 tar 内路径带 lib/ 前缀，必须解到 /usr/local/（不是 /usr/local/lib/node_modules/）
tar -xzf pm2-global.tar.gz -C /usr/local/
ln -sf /usr/local/lib/node_modules/pm2/bin/pm2 /usr/local/bin/pm2
```

MySQL 8 首次初始化（无 validate_password 时可跳过中间步骤，直接设目标密码）：

```bash
systemctl enable --now mysqld
grep 'temporary password' /var/log/mysqld.log        # 取临时密码
mysql -uroot -p   # ERROR 1820：必须先 ALTER USER 改密码才能执行其他语句
# 若 ERROR 1819（密码策略拒绝纯 hex）：先改成合规临时密码 → 卸载密码策略组件 → 再改目标密码
mysql -uroot -p -e "UNINSTALL COMPONENT 'file://component_validate_password';"
```

Prisma 离线引擎：[schema.prisma](../server/prisma/schema.prisma) 的 generator 已配置
`binaryTargets = ["native", "rhel-openssl-1.0.x"]`，`prisma generate` 会把 CentOS 7（glibc 2.17 /
OpenSSL 1.0.2）可用的查询引擎打进 `node_modules/.prisma/client/`，随 node_modules 一起上传即可。

## 2. 建库

```bash
sudo mysql -e "CREATE DATABASE typing_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'typing'@'localhost' IDENTIFIED BY '<强密码>';"
sudo mysql -e "GRANT ALL PRIVILEGES ON typing_system.* TO 'typing'@'localhost'; FLUSH PRIVILEGES;"
```

## 3. 构建并上传产物

本机执行：

```bash
cd web && npm ci && npm run build          # 产出 web/dist
cd ../server && npm ci && npm run build    # 产出 server/dist
# 上传
scp -r web/dist/* user@server:/var/www/typing/web-dist/
rsync -a --exclude node_modules --exclude .env server/ user@server:/var/www/typing/server/
scp -r deploy/ user@server:/var/www/typing/deploy/
```

CentOS 7 离线服务器无法在服务器上跑 `npm ci`，需本机打整包上传（含 linux 查询引擎）：

```bash
cd server
npm ci --os=linux --cpu=x64 --ignore-scripts   # 跳过 postinstall，防下载 darwin 引擎
npx prisma generate                            # 手动生成 client（含 native + rhel 两套引擎）
tar -czf server-node_modules.tar.gz node_modules
scp server-node_modules.tar.gz root@server:/root/
# 服务器上解压到 /var/www/typing/server/
```

## 4. 后端安装与迁移（服务器上）

```bash
cd /var/www/typing/server
npm ci
# 生产环境变量（.env）
cat > .env <<'EOF'
DATABASE_URL="mysql://typing:<强密码>@localhost:3306/typing_system"
JWT_SECRET="<随机长字符串>"
PORT=3000
EOF
npx prisma migrate deploy   # 建表
npx prisma db seed          # 超管 admin/admin123（首次登录强制改密）+ 内置文章
# 注意：package.json#prisma.seed 已固化为 node --loader 方式，兼容 "type": "module" 项目（node 18+ 均可）
```

离线服务器（CentOS 7）上跑不了 prisma CLI：在本机开 SSH 隧道后用本地 prisma 执行，
schema/引擎均用本机 darwin 版即可：

```bash
ssh -N -L 3307:127.0.0.1:3306 root@<服务器IP>   # 保持挂起
cd server
DATABASE_URL="mysql://typing:<密码>@127.0.0.1:3307/typing_system" npx prisma migrate deploy
DATABASE_URL="mysql://typing:<密码>@127.0.0.1:3307/typing_system" npx prisma db seed
```

## 5. PM2 启动后端

```bash
pm2 start /var/www/typing/deploy/ecosystem.config.js
pm2 save && pm2 startup     # 开机自启
curl http://127.0.0.1:3000/api/health   # 期望 {"status":"ok"} 类响应
```

## 6. Nginx 挂载

```bash
sudo cp /var/www/typing/deploy/nginx.conf /etc/nginx/conf.d/typing.conf
sudo nginx -t && sudo systemctl reload nginx
```

Rocky/RHEL 9 注意：主配置 `/etc/nginx/nginx.conf` 的 http 段自带一个 `server_name _` 的默认
server 块，会与本站冲突（`nginx -t` 报 conflicting server name 警告），需注释该段后再 reload。

CentOS 7（nginx.org rpm）注意：默认 server 在 `/etc/nginx/conf.d/default.conf`（不在主配置），
直接改名移开即可：

```bash
mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
```

CentOS 7 SELinux 若为 Enforcing，还需放行 Nginx 反代外连与修正站点目录上下文：

```bash
setsebool -P httpd_can_network_connect 1
restorecon -R /var/www/typing
```

## 7. 验收清单

1. `curl http://127.0.0.1/api/health` → 200
2. 浏览器打开 `http://<服务器IP>/` → 跳转登录页
3. `admin / admin123` 登录 → 强制改密 → 超管三页正常
4. 建教师 → 教师建班/批量生成学生 → 发布任务 → 学生打字 → 实时看板/成绩导出

## 8. 定时备份

```bash
sudo chmod +x /var/www/typing/deploy/backup.sh
crontab -e
# 每晚 2 点备份，保留最近 7 天（脚本内自动清理）
0 2 * * * MYSQL_USER=typing MYSQL_PWD='<数据库密码>' /var/www/typing/deploy/backup.sh >> /var/log/typing/backup.log 2>&1
```

注意：Rocky 9 的 MySQL root@localhost 走 auth_socket 认证，mysqldump 必须用 `typing` 用户备份；
`--no-tablespaces` 已写入 backup.sh（typing 用户无 PROCESS 权限）。

恢复：`gunzip < /var/backups/typing/<日期>.sql.gz | mysql -u typing -p typing_system`

## 课堂管理 P1（考勤）上线步骤

1. 上传新 server dist + prisma 目录；新 dist 依赖重生成的 client 模型（classSession/pointRecord 等），按 §3 离线整包流程本机 `npx prisma generate` + node_modules 整包上传；`npx prisma migrate deploy` 应用 `*_classroom_management` 迁移（先手动备份：跑一次 backup.sh）
2. 上传新 web dist 至 /var/www/typing/web-dist
3. `pm2 restart typing-api`；教师端登录验证「课堂管理 ▾ 开课考勤」开/结课一次
4. 回滚 = 还原备份 + 旧 dist；class_session/attendance/point_record 为新表，旧版本代码不读取，无需回滚迁移

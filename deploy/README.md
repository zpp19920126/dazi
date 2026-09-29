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

Rocky/RHEL 9（本次实际部署环境）：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs mysql-server nginx
npm i -g pm2
mkdir -p /var/www/typing/web-dist /var/www/typing/server /var/www/typing/deploy /var/log/typing /var/backups/typing
systemctl enable --now mysqld nginx
```

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

#!/usr/bin/env bash
# 打字系统数据库备份：gzip 压缩 + 仅保留最近 7 天
# crontab -e 添加：
#   0 2 * * * /var/www/typing/deploy/backup.sh >> /var/log/typing/backup.log 2>&1
set -euo pipefail

MYSQL_USER="${MYSQL_USER:-root}"
# 密码通过环境变量传入（crontab 行前可写 MYSQL_PWD=xxx），避免出现在进程列表中
MYSQL_PWD="${MYSQL_PWD:?请先设置环境变量 MYSQL_PWD}"
DB_NAME="${DB_NAME:-typing_system}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/typing}"

mkdir -p "$BACKUP_DIR"

export MYSQL_PWD
mysqldump -u "$MYSQL_USER" --single-transaction "$DB_NAME" \
  | gzip > "$BACKUP_DIR/$(date +%F).sql.gz"

# 保留最近 7 份，其余删除
find "$BACKUP_DIR" -name '*.sql.gz' -mtime +7 -delete

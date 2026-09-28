module.exports = {
  apps: [{
    name: 'typing-api',
    cwd: '/var/www/typing/server',
    script: 'dist/main.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    // PM2 日志时间戳（out_date_format 并非 PM2 选项，正确选项为 time）
    time: 'YYYY-MM-DD_HH:mm:ss',
    error_file: '/var/log/typing/err.log',
    out_file: '/var/log/typing/out.log',
  }],
};

module.exports = {
  apps: [{
    name: 'typing-api',
    cwd: '/var/www/typing/server',
    script: 'dist/main.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    // PM2 日志时间戳
    time: true,
    error_file: '/var/log/typing/err.log',
    out_file: '/var/log/typing/out.log',
  }],
};

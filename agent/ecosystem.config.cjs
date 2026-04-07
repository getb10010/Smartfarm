module.exports = {
  apps: [
    {
      name: 'smartfarmer-oracle',
      script: 'npm',
      args: 'run start',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DIALECT_ENABLED: 'false'
      }
    }
  ]
};

module.exports = {
  apps: [
    {
      name: 'platform',
      cwd: '/workspaces/CleverPlatform/platform',
      script: 'node_modules/.bin/next',
      args: 'dev --webpack',
      env: {
        NODE_OPTIONS: '--max-old-space-size=1536',
        NODE_ENV: 'development',
        PORT: 3000,
      },
      watch: false,
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
    },
  ],
};

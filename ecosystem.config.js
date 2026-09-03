// PM2 ecosystem for iq-metrix.
//
// Unlike the Next.js sibling services in this workspace (translator, money,
// transcribe, iq-mermaid), which run `pm2 start npm -- start` directly from
// their deploy.yml with no ecosystem file, this is a plain compiled Node
// service (Fastify, no Next runtime) — so it follows the iq-rest monorepo's
// ecosystem.prod.config.js shape instead: a real `script` entrypoint, fork
// mode (single process; the in-memory salt cache/rotation lock and the
// rate-limiter in src/server.ts are per-process state, so this must stay a
// single instance unless that state is moved to a shared store).
//
// Local dev does not use this file — see README.md ("npm run dev"). This is
// for `pm2 start ecosystem.config.js` on the server, done by
// .github/workflows/deploy.yml.

module.exports = {
  apps: [
    {
      name: "iq-metrix",
      cwd: __dirname,
      script: "dist/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "20s",
      kill_timeout: 8000,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

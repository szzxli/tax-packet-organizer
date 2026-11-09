-- 生产迁移：第一方事件表（推广开始后要能按渠道数「到达 / 开始整理 / 导出完成 / 领季票」）
-- 执行：npx wrangler d1 execute DB --remote --file=test/migrations/2026-11-09-events.sql
-- 幂等：可重复执行；只建表建索引，不改动任何已有行。
--
-- 隐私口径（与现有后端一致，且更严）：这一张表不存 IP、不存 UA、不存邮箱、不存账号、
-- 不存文件内容、不存金额。anon 只是浏览器本地随机 UUID 的前 16 位，用来把同一次访问的
-- 几个动作串起来，反查不到人。设备只存 desktop / tablet / mobile / unknown 四档。
CREATE TABLE IF NOT EXISTS events (
  ts INTEGER NOT NULL,
  name TEXT NOT NULL,
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  anon TEXT NOT NULL DEFAULT ''
);
-- 看板上的三种问法各一条索引：最新 N 条、某事件的时间序列、某渠道的时间序列。
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);
CREATE INDEX IF NOT EXISTS idx_events_source_ts ON events(utm_source, ts);
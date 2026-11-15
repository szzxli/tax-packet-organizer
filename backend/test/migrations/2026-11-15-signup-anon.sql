-- 2026-11-15 · 报名落库补 anon
-- 目的：把「到达（open）/ 开始填表（signup_start）/ 提交（signup）」串成同一个人，
-- 用的是 track.js 已经写在 localStorage['tpo_anon'] 的随机串前 16 位；不新增采集、不收 IP。
-- 与 formsubmit 双写不变；ref 原样存，不做映射。
ALTER TABLE signup_leads ADD COLUMN anon TEXT;
CREATE INDEX IF NOT EXISTS idx_signup_leads_anon ON signup_leads(anon);
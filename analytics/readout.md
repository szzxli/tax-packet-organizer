# 到达与报名日读数（唯一口径）

2026-11-13 定。数据源：D1 `events`（`name='open'`）与 `signup_leads`。
计数单位：**`open` 一条 = 一次页面加载**。`formal.html` 自己的上报每次加载都发（实测同一匿名串 30 秒内连发 6 条），所以**报「人数」一律用 `COUNT(DISTINCT anon)`，不能报 `COUNT(*)`**；想看加载次数时才报 `COUNT(*)`，两个数一起写。

## 分桶映射（原样入库，查询时分桶）

> **渠道词一律前缀匹配（2026-11-16 起）。** 同一个渠道会带轮次后缀落地——`?ref=reddit` 与 `?ref=reddit-r1` 都算论坛线，`seo-<slug>` 算 SEO 线。精确等值会让 `reddit-r1` 掉进 `other` 而静默归零，所以映射只认前缀，加后缀不改 CASE。

| 桶 | 条件 |
|---|---|
| social | `utm_medium='ref'` 且 `utm_source LIKE 'xhs%'` |
| forum | `utm_medium='ref'` 且（`utm_source LIKE 'reddit%'` 或 `LIKE 'moonbbs%'` 或 `LIKE 'quora%'`） |
| community | `utm_medium='ref'` 且（`utm_source LIKE 'nextdoor%'` 或 `LIKE 'fbgroup%'`） |
| seo | `utm_medium='ref'` 且 `utm_source LIKE 'seo-%'` |
| directory | `utm_medium='ref'` 且（`utm_source LIKE 'alternativeto%'` 或 `LIKE 'github%'`） |
| email | `utm_medium='ref'` 且（`utm_source LIKE 'cpa%'` 或 `LIKE 'email%'`） |
| search | `utm_medium='search'`（搜索引擎 referrer，无需 `?ref=`） |
| referral | `utm_medium='referral'` |
| direct | `utm_medium='direct'` |
| other | 其余（只列数，**不参与任何止损判决**） |

> 已挂出的 ref 实值是六个渠道词：`reddit`、`moonbbs`、`alternativeto`、`github`、`cpa-handoff`、`email-cpa-survey`；同一个渠道的轮次变体（如 `reddit-r1`）同桶。
> 待挂的还有四个：`quora`、`nextdoor`、`fbgroup`、`seo-<slug>`（10 页各一个 slug，还会继续加）。
> 旧名 `cpa`、`email` 保留在映射里只作兼容，不要据此判断邮件线死了。
> `other` 里若出现 `quora`／`nextdoor`／`fbgroup`／`seo-`／`reddit` 前缀，说明 CASE 没生效，按实现缺陷处理，不算渠道 0。
> 2026-11-16 改前缀匹配的原因：`signup_leads` 里已有 `ref='reddit-r1'` 的行，旧的精确等值会把这条最大流量线的点击静默归入 `other`；同日核到 events 全时段还没有任何 `utm_source LIKE 'reddit%'` 的到达，所以这次改的是「别把将来的点击读成 0」，不是找回既有流量。

## 日读数 SQL（前一天 00:00–24:00 PT）

```sql
SELECT
  CASE
    WHEN utm_medium='ref' AND utm_source LIKE 'seo-%' THEN 'seo'
    WHEN utm_medium='ref' AND utm_source LIKE 'xhs%' THEN 'social'
    WHEN utm_medium='ref' AND (utm_source LIKE 'reddit%' OR utm_source LIKE 'moonbbs%' OR utm_source LIKE 'quora%') THEN 'forum'
    WHEN utm_medium='ref' AND (utm_source LIKE 'nextdoor%' OR utm_source LIKE 'fbgroup%') THEN 'community'
    WHEN utm_medium='ref' AND (utm_source LIKE 'alternativeto%' OR utm_source LIKE 'github%') THEN 'directory'
    WHEN utm_medium='ref' AND (utm_source LIKE 'cpa%' OR utm_source LIKE 'email%') THEN 'email'
    WHEN utm_medium='search' THEN 'search'
    WHEN utm_medium='referral' THEN 'referral'
    WHEN utm_medium='direct' THEN 'direct'
    ELSE 'other'
  END AS bucket,
  COUNT(*) AS arrivals
FROM events
WHERE name='open'
  AND ts >= :start AND ts < :end
GROUP BY 1 ORDER BY 2 DESC;
```

```sql
SELECT COUNT(*) AS signups
FROM signup_leads
WHERE created_at >= :start AND created_at < :end
  AND email NOT LIKE 'qa.%@example.com';
```

## QA 测试行（常设过滤，不只 11-15 一天）

研发做端到端实测时会在真库留 `qa.*@example.com` 的报名行（2026-11-15 21:16 GMT 前后留了 `qa.track.20261115@`、`qa.live.20261115@` 两条，anon `6c1f9a2b3d4e5f60`／`a1b2c3d4e5f60718`）。这些行**是真行数、不删**（删了当日对账会断），但**不算报名、也不算到达**——同一批 QA 会话的 `open` 也在 `events` 里。

**做法：先取 QA 的 anon 名单，再用它同时清 `events` 与 `signup_leads`。**

```sql
-- 0) QA 名单（按需放宽天数，这里取最近 7 天）
SELECT DISTINCT anon FROM signup_leads
WHERE email LIKE 'qa.%@example.com' AND anon <> '';
```

三层计数都加这一句（把上面结果写成 IN 列表，或直接子查询）：

```sql
AND anon NOT IN (SELECT anon FROM signup_leads
                 WHERE email LIKE 'qa.%@example.com' AND anon <> '')
```

`signup_leads` 那侧同时加 `AND email NOT LIKE 'qa.%@example.com'`；两侧都过滤，对账才有意义。

- 2026-11-15 实测（PT 当日，原始 → 扣 QA 后）：报名 **2 → 0**；`signup` 事件 **2 → 0**；到达 **2 → 2**、开始填 **2 → 2**（当日这两条 `open` 的 anon 不在 QA 名单里，是真实会话；那两次 QA 实测没有在当日留下 `open`）。所以 11-15 的真实读数是：到达 2、开始填 2、报名 **0**。
- 凡是研发当天做过端到端实测的，第二天读数先跑第 0 步，有 QA 行就过滤，并在消息里点一句「已扣 QA n 条报名／n 次到达」。

## 三层漏斗（2026-11-15 起）

到达 → 开始填 → 提交，三层同一天同一口径，且都先扣掉 QA（见上一节）：

```sql
-- 第一层：到达（人数 = 去重匿名串；formal.html 每次加载都发，不能用 COUNT(*) 当人）
SELECT COUNT(DISTINCT anon) FROM events
WHERE name='open' AND ts >= :start AND ts < :end
  AND anon NOT IN (SELECT anon FROM signup_leads WHERE email LIKE 'qa.%@example.com' AND anon <> '');
-- 第二层：开始填（任一即算，同样按人去重）
SELECT COUNT(DISTINCT anon) FROM events
WHERE name IN ('flow-step1','signup_start') AND ts >= :start AND ts < :end
  AND anon NOT IN (SELECT anon FROM signup_leads WHERE email LIKE 'qa.%@example.com' AND anon <> '');
-- 第三层：提交
SELECT COUNT(DISTINCT anon) FROM events
WHERE name='signup' AND ts >= :start AND ts < :end
  AND anon NOT IN (SELECT anon FROM signup_leads WHERE email LIKE 'qa.%@example.com' AND anon <> '');
```

第三层的两个数（`signup` 事件数 与 过滤后的 `signup_leads` 行数）**必须相等**；不等即实现缺陷，当天修，不当 0 记、不写进判据。

`start`/`end` 用 PT 当日 00:00 的 epoch 毫秒（11 月为 UTC-8）。

## 判据

到 2026-11-30：收录 ≥8 页；`ref` 到达 ≥60（social + forum + community + seo + directory + email 求和）、`search` 到达 ≥40，合计 ≥100；开口问 ≥10 人且 ≥3 人问到具体动作。
判据里的「到达」一律指**去重人数**（`COUNT(DISTINCT anon)`），不是加载次数。
`other` 不计入任何一项；`other` 里若出现 `quora`／`nextdoor`／`fbgroup`／`seo-`／`reddit` 前缀，算实现缺陷，不算渠道 0。https 开关落地前，涉及 https 的收录项标「仪器未通（https）」。
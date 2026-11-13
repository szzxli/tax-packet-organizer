# 到达与报名日读数（唯一口径）

2026-11-13 定。数据源：D1 `events`（`name='open'`）与 `signup_leads`。
计数单位：**每会话一条**。`formal.html` 与其余 5 页共用 `sessionStorage.tpo_open_sent`，刷新不重复计。

## 分桶映射（原样入库，查询时分桶）

| 桶 | 条件 |
|---|---|
| social | `utm_medium='ref'` 且 `utm_source='xhs'` |
| forum | `utm_medium='ref'` 且 `utm_source IN ('reddit','moonbbs')` |
| directory | `utm_medium='ref'` 且 `utm_source IN ('alternativeto','github')` |
| email | `utm_medium='ref'` 且 `utm_source IN ('cpa-handoff','email-cpa-survey','email')` |
| search | `utm_medium='search'`（搜索引擎 referrer，无需 `?ref=`） |
| referral | `utm_medium='referral'` |
| direct | `utm_medium='direct'` |
| other | 其余（只列数，**不参与任何止损判决**） |

> 线上已挂出的 ref 实值只有六个：`reddit`、`moonbbs`、`alternativeto`、`github`、`cpa-handoff`、`email-cpa-survey`。
> 旧名 `cpa`、`email` 保留在映射里只作兼容，不要据此判断邮件线死了。

## 日读数 SQL（前一天 00:00–24:00 PT）

```sql
SELECT
  CASE
    WHEN utm_medium='ref' AND utm_source='xhs' THEN 'social'
    WHEN utm_medium='ref' AND utm_source IN ('reddit','moonbbs') THEN 'forum'
    WHEN utm_medium='ref' AND utm_source IN ('alternativeto','github') THEN 'directory'
    WHEN utm_medium='ref' AND utm_source IN ('cpa-handoff','email-cpa-survey','email') THEN 'email'
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
WHERE created_at >= :start AND created_at < :end;
```

`start`/`end` 用 PT 当日 00:00 的 epoch 毫秒（11 月为 UTC-8）。

## 判据

到 2026-11-30：收录 ≥8 页；`ref` 到达 ≥60、`search` 到达 ≥40，合计 ≥100；开口问 ≥10 人且 ≥3 人问到具体动作。
`other` 不计入任何一项。https 开关落地前，涉及 https 的收录项标「仪器未通（https）」。
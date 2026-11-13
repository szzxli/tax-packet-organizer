// 第一方到达埋点：sitemap 静态页共用。
// 只回答三件事：从哪来、落在哪一页、是不是同一次会话。不读 cookie、不收邮箱与文件内容。
// 归因优先级：显式 utm > ?ref= > 搜索引擎 referrer > 其它 referrer > direct。
// 一次会话只上报一条 open；站内翻页沿用首跳的 ref。
(function () {
  try {
    if (/[?&]probe=1(&|$)/.test(location.search)) return;
    var q = new URLSearchParams(location.search);
    var ref = (q.get('ref') || '').trim().slice(0, 120);
    var utmSource = (q.get('utm_source') || '').trim().slice(0, 64);
    var utmMedium = (q.get('utm_medium') || '').trim().slice(0, 64);
    var utmCampaign = (q.get('utm_campaign') || '').trim().slice(0, 64);

    if (ref) {
      try { sessionStorage.setItem('tpo_ref', ref); } catch (e) {}
    } else {
      try { ref = sessionStorage.getItem('tpo_ref') || ''; } catch (e) {}
    }

    var sent = false;
    try { sent = sessionStorage.getItem('tpo_open_sent') === '1'; } catch (e) {}
    if (sent) return;

    var src = utmSource;
    var med = utmMedium;
    if (!src && ref) { src = ref; med = 'ref'; }

    if (!src) {
      var host = '';
      try {
        host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
      } catch (e) {}
      if (host) {
        if (/(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia)\./.test(host)) {
          src = host; med = 'search';
        } else {
          src = host; med = 'referral';
        }
      }
    }
    if (!src) { src = 'direct'; med = 'direct'; }

    var anon = '';
    try {
      anon = localStorage.getItem('tpo_anon') || '';
      if (!anon) {
        anon = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2));
        localStorage.setItem('tpo_anon', anon);
      }
    } catch (e) {}

    var dev = 'unknown';
    try { dev = innerWidth <= 600 ? 'mobile' : (innerWidth <= 900 ? 'tablet' : 'desktop'); } catch (e) {}

    var body = {
      events: [{
        name: 'open', ts: Date.now(),
        utm_source: src, utm_medium: med, utm_campaign: utmCampaign,
        path: location.pathname, device: dev, anon: String(anon).slice(0, 16)
      }]
    };
    try { sessionStorage.setItem('tpo_open_sent', '1'); } catch (e) {}
    fetch('https://tax-packet-api.szzxli711.workers.dev/api/events', {
      method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body)
    }).catch(function () {});
  } catch (e) {}
})();
// A-share four-line capital game intraday chart
// Uses local proxy server.py for EastMoney data.
(() => {
  'use strict';

  const MINUTE_PROXIES = [
    (m, c) => `/api/minute?market=${m}&code=${c}`,
    (m, c) => `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${m}.${c}`,
  ];
  const DAILY_PROXIES = [
    (m, c) => `/api/daily?market=${m}&code=${c}`,
    (m, c) => `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${m}.${c}`,
  ];
  const QUOTE_PROXIES = [
    (m, c) => `/api/quote?market=${m}&code=${c}`,
    (m, c) => `https://push2.eastmoney.com/api/qt/stock/get?secid=${m}.${c}&fields=f43,f44,f45,f46,f60,f57,f58,f169,f170`,
  ];

  const KL_PROXIES = [
    (m, c) => `/api/kline?market=${m}&code=${c}`,
    (m, c) => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${m}.${c}`
      + `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`
      + `&klt=101&fqt=1&end=20991231&lmt=30`,
  ];

  const COLORS = { jg: '#ff5b5b', zl: '#ffb020', zh: '#4fa8ff', sh: '#5fd49a' };

  const FLOW_SERIES = [
    { name: '机构', color: COLORS.jg, src: 'superLarge' },
    { name: '主力', color: COLORS.zl, src: 'large' },
    { name: '中户', color: COLORS.zh, src: 'medium' },
    { name: '散户', color: COLORS.sh, src: 'small' },
  ];
  function endLabelStyle(color) {
    return { show: true, distance: 10, color: color, fontSize: 11, fontWeight: 600 };
  }

  const INDEX_MARKET = {
    '000001': 1, '000002': 1, '000003': 1,
    '000016': 1, '000300': 1, '000688': 1, '000905': 1, '000852': 1,
    '399001': 0, '399002': 0, '399003': 0,
    '399005': 0, '399006': 0, '399016': 0, '399300': 0, '399905': 0,
  };

  function buildTimeSlots() {
    const slots = [];
    for (let h = 9; h <= 11; h++) {
      const start = h === 9 ? 30 : 0;
      const end = h === 11 ? 30 : 59;
      for (let m = start; m <= end; m++) slots.push(pad(h) + ':' + pad(m));
    }
    for (let h = 13; h <= 15; h++) {
      const end = h === 15 ? 0 : 59;
      for (let m = 0; m <= end; m++) slots.push(pad(h) + ':' + pad(m));
    }
    return slots;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function detectMarkets(code) {
    if (INDEX_MARKET.hasOwnProperty(code)) return [INDEX_MARKET[code]];
    if (/^BK/.test(code)) return [90];
    if (/^000/.test(code)) return [1, 0];
    if (/^399/.test(code)) return [0, 1];
    const first = code[0];
    if (/[69]/.test(first)) return [1];
    if (/[57]/.test(first)) return [1, 0];
    if (/[03]/.test(first)) return [0];
    if (/[12]/.test(first)) return [0, 1];
    if (/[489]/.test(first)) return [0, 1];
    return [1, 0];
  }

  function fmtWan(v) {
    if (v == null || isNaN(v)) return '-';
    const wan = v / 10000;
    const abs = Math.abs(wan);
    if (abs >= 10000) return (wan / 10000).toFixed(2) + 'Y';
    if (abs >= 1000) return wan.toFixed(0) + 'W';
    if (abs >= 1) return wan.toFixed(1) + 'W';
    return wan.toFixed(2) + 'W';
  }
  function fmtYi(v) {
    if (v == null || isNaN(v)) return '-';
    return (v / 100000000).toFixed(2) + 'Y';
  }
  function fmtYiVal(v) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(2) + 'Y';
  }
  function fmtYiSigned(v) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + fmtYi(v);
  }
  function fmtWanSigned(v) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + fmtWan(v);
  }
  function toMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  async function tryProxies(proxies, market, code) {
    let lastErr = null;
    for (const buildUrl of proxies) {
      const url = buildUrl(market, code);
      try {
        const resp = await fetch(url);
        if (!resp.ok) { lastErr = (url.startsWith('/') ? 'proxy' : 'direct') + ' HTTP ' + resp.status; continue; }
        const json = await resp.json();
        // Return any non-empty .data payload; callers validate shape (klines for
        // minute/daily, snapshot fields for quote).
        if (json.rc === 0 && json.data) return json.data;
        lastErr = (url.startsWith('/') ? 'proxy' : 'direct') + ' empty';
      } catch (e) {
        lastErr = (url.startsWith('/') ? 'proxy' : 'direct') + ' ' + (e.message || e);
      }
    }
    return { __error: lastErr || 'unknown' };
  }

  async function fetchMinuteFlow(code, opts) {
    opts = opts || {};
    if (!/^[0-9A-Z]{6}$/.test(code)) {
      const err = new Error('代码格式错误：' + code);
      err.code = 'INVALID_FORMAT';
      throw err;
    }
    const markets = opts.marketOverride !== undefined ? [opts.marketOverride] : detectMarkets(code);
    const errors = [];
    for (const market of markets) {
      const data = await tryProxies(MINUTE_PROXIES, market, code);
      if (!data.__error) return parseMinuteKlines(data);
      errors.push('m=' + market + ' ' + data.__error);
    }
    const allNetworkErr = errors.every((m) => /HTTP|TypeError|Failed|fetch/i.test(m));
    const err = new Error(allNetworkErr
      ? '网络异常（东方财富 API 不可达）：' + errors[0]
      : '未找到股票：' + code);
    err.code = allNetworkErr ? 'NETWORK' : 'NOT_FOUND';
    err.detail = errors.join('; ');
    throw err;
  }

  function parseMinuteKlines(data) {
    const points = data.klines.map((line) => {
      const parts = line.split(',');
      const [date, time] = parts[0].split(' ');
      return { date, time,
        superLarge: parseFloat(parts[5]),
        large: parseFloat(parts[4]),
        medium: parseFloat(parts[3]),
        small: parseFloat(parts[2]) };
    });
    return {
      code: data.code, name: data.name, market: data.market,
      date: points.length ? points[0].date : '',
      points,
    };
  }

  async function fetchDailyFlow(code, opts) {
    opts = opts || {};
    if (!/^[0-9A-Z]{6}$/.test(code)) {
      const err = new Error('代码格式错误：' + code);
      err.code = 'INVALID_FORMAT';
      throw err;
    }
    const markets = opts.marketOverride !== undefined ? [opts.marketOverride] : detectMarkets(code);
    const errors = [];
    for (const market of markets) {
      const data = await tryProxies(DAILY_PROXIES, market, code);
      if (!data.__error) return parseDailyKlines(data);
      errors.push('m=' + market + ' ' + data.__error);
    }
    const err = new Error('无日线数据：' + code);
    err.code = 'NOT_FOUND';
    err.detail = errors.join('; ');
    throw err;
  }

  async function fetchQuote(code, opts) {
    opts = opts || {};
    if (!/^[0-9A-Z]{6}$/.test(code)) {
      const err = new Error('代码格式错误：' + code);
      err.code = 'INVALID_FORMAT';
      throw err;
    }
    const markets = opts.marketOverride !== undefined ? [opts.marketOverride] : detectMarkets(code);
    const errors = [];
    for (const market of markets) {
      const data = await tryProxies(QUOTE_PROXIES, market, code);
      if (!data.__error) return parseQuote(data);
      errors.push('m=' + market + ' ' + data.__error);
    }
    const err = new Error('无行情快照：' + code);
    err.code = 'NOT_FOUND';
    err.detail = errors.join('; ');
    throw err;
  }
  function parseQuote(data) {
    // EastMoney wraps fields under .data.*; fall back to top-level for safety.
    const d = (data && data.data) || data || {};
    const prev = d.f60 != null ? d.f60 / 100 : null;
    const last = d.f43 != null ? d.f43 / 100 : null;
    const pct  = d.f170 != null ? d.f170 / 100 : null;
    const abs  = d.f169 != null ? d.f169 / 100 : null;
    return { code: d.f57, name: d.f58, prev, last, changePercent: pct, change: abs };
  }

  async function fetchKline(code, opts) {
    opts = opts || {};
    const markets = opts.marketOverride !== undefined ? [opts.marketOverride] : detectMarkets(code);
    for (const market of markets) {
      const data = await tryProxies(KL_PROXIES, market, code);
      if (!data.__error) {
        const parsed = parseKline(data);
        if (parsed) return parsed;
      }
    }
    const err = new Error("\u5386\u53f2\u884c\u60c5\u52a0\u8f7d\u5931\u8d25");
    err.code = 'KLINE_FAILED';
    throw err;
  }

  function parseKline(data) {
    const d = (data && data.data) || data || {};
    if (!d.klines || !d.klines.length) return null;
    const days = d.klines.map((line) => {
      const p = line.split(',');
      return {
        date: p[0],
        open: parseFloat(p[1]),
        close: parseFloat(p[2]),
        high: parseFloat(p[3]),
        low: parseFloat(p[4]),
        changePercent: parseFloat(p[8]),
        changeAmount: parseFloat(p[9]),
      };
    });
    return { code: d.code, name: d.name, days };
  }

  function parseDailyKlines(data) {
    const days = data.klines.map((line) => {
      const p = line.split(',');
      return {
        date: p[0],
        superLarge: parseFloat(p[5]),
        large: parseFloat(p[4]),
        medium: parseFloat(p[3]),
        small: parseFloat(p[2]),
        mainForce: parseFloat(p[1]),
        mainRatio: parseFloat(p[6]),
        mainFlowYi: parseFloat(p[1]) / 1e8,
      };
    });
    return { code: data.code, name: data.name, market: data.market, days };
  }

  function generateMockMinute(code) {
    const slots = buildTimeSlots();
    let rng = mulberry32(hashCode(code));
    let jg = 0, zl = 0, zh = 0, sh = 0;
    let trend = (rng() - 0.5) * 6000000;
    const points = slots.map((time) => {
      const tm = toMinutes(time);
      const isLunch = tm >= 11 * 60 + 30 && tm < 13 * 60;
      const isOpen = tm < 10 * 60;
      const isClose = tm >= 14 * 60 + 30;
      let intensity = isLunch ? 0.05 : isOpen ? 2.2 : isClose ? 1.8 : 1;
      trend += (rng() - 0.5) * 800000;
      trend = clamp(trend, -12000000, 12000000);
      const baseDelta = trend * 0.012 * intensity;
      jg += (baseDelta + (rng() - 0.5) * 400000);
      zl += (baseDelta * 0.55 + (rng() - 0.5) * 320000) * 0.8;
      zh += (-baseDelta * 0.18 + (rng() - 0.5) * 220000) * 0.5;
      sh += (-baseDelta * 0.25 + (rng() - 0.5) * 280000) * 1.1;
      return { date: new Date().toISOString().slice(0, 10), time,
        superLarge: jg, large: zl, medium: zh, small: sh };
    });
    return { code, name: 'Mock data (' + code + ')', market: detectMarkets(code)[0],
      date: points[0].date, points };
  }

  function generateMockDaily(code) {
    const days = [];
    let rng = mulberry32(hashCode(code));
    let jg = 0, zl = 0, zh = 0, sh = 0;
    const today = new Date();
    const d = new Date(today);
    while (days.length < 10) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        jg += (rng() - 0.5) * 8e9;
        zl += (rng() - 0.5) * 5e9;
        zh += (rng() - 0.5) * 3e9;
        sh += (rng() - 0.5) * 4e9;
        const mainForce = jg + zl;
        days.push({
          date: d.toISOString().slice(0, 10),
          superLarge: jg, large: zl, medium: zh, small: sh, mainForce,
          mainRatio: ((mainForce / 1e10) * 100),
          mainFlowYi: mainForce / 1e8,
        });
      }
      d.setDate(d.getDate() - 1);
    }
    return { code, name: 'Mock data (' + code + ')', market: detectMarkets(code)[0], days };
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return h;
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  let chart = null;
  function initChart() {
    const el = document.getElementById('chart');
    // SVG renderer instead of canvas: avoids GPU-composited canvas tearing in
    // embedded/panel browsers, and stays fast at this data volume.
    chart = echarts.init(el, null, { renderer: 'svg' });
    window.addEventListener('resize', () => chart && chart.resize());
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => chart && chart.resize()).observe(el);
    }
  }
  function ensureChart() {
    // echarts.init throws when the container has no layout size yet, which would
    // abort boot and leave the whole page blank.
    if (!chart) {
      try {
        initChart();
      } catch (e) {
        console.warn('[chart] init deferred:', e && e.message);
        return false;
      }
    }
    return true;
  }

  function renderMinuteChart(data) {
    const slots = buildTimeSlots();
    const map = new Map();
    data.points.forEach((p) => map.set(p.time, p));
    const aligned = slots.map((t) => map.get(t) || null);
    // Always show the full trading day (09:30 -> 15:00) on the x-axis; untraded
    // slots are bridged via connectNulls: true, so the line stays continuous.
    const series = seriesFromAligned(aligned);
    const last = data.points[data.points.length - 1] || {};
    ensureChart();
    if (chart) chart.setOption(buildOption(slots, series, data.date), true);
    updateInfoBarMinute(data, last);
  }

  function renderDailyChart(data, dateStr) {
    const days = (data && data.days) || [];
    if (!days.length) return;
    const selIndex = Math.max(0, days.findIndex((d) => d.date === dateStr));
    const day = days[selIndex];
    const labels = days.map((d) => d.date);
    const series = FLOW_SERIES.map((s, i) => ({
      name: s.name, type: 'line', smooth: true, symbol: 'circle',
      symbolSize: (v, p) => (p.dataIndex === selIndex ? 9 : 0),
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color, borderColor: '#0e1117', borderWidth: 2 },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      connectNulls: true,
      endLabel: Object.assign(endLabelStyle(s.color), { formatter: s.name }),
      labelLayout: { moveOverlap: 'shiftY' },
      data: days.map((d) => d[s.src]),
      markLine: i === 0 ? {
        silent: true, symbol: 'none',
        lineStyle: { color: '#f0b400', type: 'dashed', width: 1 },
        label: { show: true, position: 'insideEndTop', color: '#f0b400', fontSize: 10,
          rotate: 0, formatter: day.date },
        data: [{ xAxis: day.date }],
      } : undefined,
    }));
    const option = {
      backgroundColor: 'transparent', animation: false,
      grid: { left: 70, right: 76, top: 44, bottom: 44 },
      legend: { top: 8, right: 20, selectedMode: 'multiple',
        textStyle: { color: '#cdd5e3', fontSize: 12 },
        itemWidth: 18, itemHeight: 8, itemGap: 16, inactiveColor: '#4a5468' },
      graphic: [{ type: 'text', right: 20, bottom: 6,
        style: { text: '点击图例可隐藏 / 显示单条曲线',
          fill: '#5b6479', fontSize: 10 } }],
      tooltip: { trigger: 'axis',
        backgroundColor: 'rgba(20,24,33,0.95)', borderColor: '#2a3142', borderWidth: 1,
        padding: [8, 12], textStyle: { color: '#e6edf6', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: '#5b6479', width: 1, type: 'dashed' } },
        formatter: (params) => {
          if (!params || !params.length) return '';
          const lines = ['<div style="font-weight:600;margin-bottom:6px;color:#f0b400">'
            + params[0].axisValue + '</div>'];
          params.forEach((p) => {
            lines.push('<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;margin:2px 0">'
              + '<span><span style="display:inline-block;width:8px;height:8px;background:' + p.color
              + ';border-radius:2px;margin-right:8px"></span>' + p.seriesName + '</span>'
              + '<span style="font-weight:600;color:' + p.color + ';font-variant-numeric:tabular-nums">'
              + fmtYiSigned(p.data) + '</span></div>');
          });
          return lines.join('');
        } },
      xAxis: { type: 'category', data: labels, boundaryGap: false,
        axisLine: { lineStyle: { color: '#2a3142' } }, axisTick: { show: false },
        axisLabel: { color: '#8a93a6', fontSize: 11, hideOverlap: true,
          formatter: (v) => v.slice(5).replace('-', '/') },
        splitLine: { show: false } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8a93a6', fontSize: 11, formatter: (v) => fmtYi(v) },
        splitLine: { lineStyle: { color: '#1d2330', type: 'dashed' } } },
      series,
    };
    ensureChart();
    if (chart) chart.setOption(option, true);
    updateInfoBarDaily(data, day);
  }

  function seriesFromAligned(aligned) {
    return FLOW_SERIES.map((s, i) => ({
      name: s.name, type: 'line', showSymbol: false, smooth: true, symbol: 'none',
      lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      endLabel: Object.assign(endLabelStyle(s.color), { formatter: s.name }),
      labelLayout: { moveOverlap: 'shiftY' },
      data: aligned.map((p) => (p ? p[s.src] : null)),
      connectNulls: true,
      ...(i === 0 ? { markArea: { silent: true,
        data: [[ { xAxis: '11:30', itemStyle: { color: 'rgba(255,255,255,0.03)' } },
                  { xAxis: '13:00' } ]],
        label: { show: true, position: 'insideTop', color: '#5b6479', fontSize: 10, formatter: '休市' } } } : {}),
    }));
  }

  function buildOption(slots, series, dateStr) {
    return {
      backgroundColor: 'transparent', animation: false,
      grid: { left: 70, right: 76, top: 44, bottom: 60 },
      legend: { top: 8, right: 20, selectedMode: 'multiple',
        textStyle: { color: '#cdd5e3', fontSize: 12 },
        itemWidth: 18, itemHeight: 8, itemGap: 16,
        inactiveColor: '#4a5468' },
      graphic: [{
        type: 'text', right: 20, bottom: 6,
        style: { text: '点击图例可隐藏 / 显示单条曲线',
          fill: '#5b6479', fontSize: 10 } }],
      tooltip: { trigger: 'axis',
        backgroundColor: 'rgba(20,24,33,0.95)', borderColor: '#2a3142', borderWidth: 1,
        padding: [8, 12], textStyle: { color: '#e6edf6', fontSize: 12 },
        axisPointer: { type: 'cross',
          lineStyle: { color: '#5b6479', width: 1, type: 'dashed' },
          crossStyle: { color: '#5b6479', type: 'dashed' },
          label: { backgroundColor: '#1d2330', borderColor: '#2a3142', borderWidth: 1, color: '#e6edf6', padding: [4, 8] } },
        formatter: (params) => {
          if (!params || !params.length) return '';
          const t = params[0].axisValue;
          const lines = ['<div style="font-weight:600;margin-bottom:6px;color:#f0b400">' + dateStr + ' ' + t + '</div>'];
          params.forEach((p) => {
            const v = p.data;
            const val = v == null ? '<span style="color:#5b6479">休市</span>' : fmtWanSigned(v);
            lines.push('<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;margin:2px 0">' +
              '<span><span style="display:inline-block;width:8px;height:8px;background:' + p.color + ';border-radius:2px;margin-right:8px"></span>' + p.seriesName + '</span>' +
              '<span style="font-weight:600;color:' + p.color + ';font-variant-numeric:tabular-nums">' + val + '</span></div>');
          });
          return lines.join('');
        } },
      xAxis: { type: 'category', data: slots, boundaryGap: false,
        axisLine: { lineStyle: { color: '#2a3142' } }, axisTick: { show: false },
        axisLabel: { color: '#8a93a6', fontSize: 11,
          formatter: (v) => {
            const m = v.slice(3);
            // 11:30 and 13:00 are adjacent slots, so keeping both overlapped them
            return ((m === '00' || m === '30') && v !== '13:00') ? v : '';
          },
          interval: 0 },
        splitLine: { show: false } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8a93a6', fontSize: 11, formatter: (v) => fmtWan(v) },
        splitLine: { lineStyle: { color: '#1d2330', type: 'dashed' } } },
      series,
    };
  }

  function lookupChangePercent(dateStr) {
    const kd = context && context.klineData;
    if (dateStr && kd && kd.days) {
      const hit = kd.days.find((d) => d.date === dateStr);
      if (hit && hit.changePercent != null && !isNaN(hit.changePercent)) return hit.changePercent;
      // Only fall back to the live snapshot when the requested day is today.
      const now = new Date();
      const today = context.minuteDate
        || (now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
      if (dateStr !== today) return null;
    }
    const q = context && context.quote;
    if (q && q.changePercent != null && !isNaN(q.changePercent)) return q.changePercent;
    return null;
  }

  function setChangeText(dateStr) {
    const el = document.getElementById('infoChange');
    const v = lookupChangePercent(dateStr);
    if (v == null) {
      el.textContent = '—';
      el.className = 'value flat';
      return;
    }
    let sign = '+';
    if (v < 0) sign = '';
    el.textContent = sign + v.toFixed(2) + '%';
    if (v > 0) el.className = 'value up';
    else if (v < 0) el.className = 'value down';
    else el.className = 'value flat';
  }
  function updateInfoBarMinute(data, last) {
    document.getElementById('infoCode').textContent = data.code || '-';
    document.getElementById('infoName').textContent = data.name || '-';
    document.getElementById('infoDate').textContent = data.date || '-';
    setChangeText(data.date);
    [['valJG', last.superLarge], ['valZL', last.large], ['valZH', last.medium], ['valSH', last.small]]
      .forEach(([id, v]) => { document.getElementById(id).textContent = fmtWanSigned(v); });
  }
  function updateInfoBarDaily(data, day) {
    document.getElementById('infoCode').textContent = data.code || '-';
    document.getElementById('infoName').textContent = data.name || '-';
    document.getElementById('infoDate').textContent = day.date || '-';
    setChangeText(day.date);
    [['valJG', day.superLarge], ['valZL', day.large], ['valZH', day.medium], ['valSH', day.small]]
      .forEach(([id, v]) => { document.getElementById(id).textContent = fmtYiSigned(v); });
  }

  function setStatus(kind, text) {
    const dot = document.querySelector('#status .dot');
    document.getElementById('statusText').textContent = text;
    dot.className = 'dot dot-' + kind;
  }

  let bannerTimer = null;
  function showBanner(kind, text, autohideMs) {
    const bar = document.getElementById('banner');
    bar.className = 'banner banner-' + kind + ' show';
    bar.textContent = text;
    if (bannerTimer) clearTimeout(bannerTimer);
    if (autohideMs > 0) bannerTimer = setTimeout(() => bar.classList.remove('show'), autohideMs);
  }
  function hideBanner() {
    document.getElementById('banner').classList.remove('show');
    if (bannerTimer) clearTimeout(bannerTimer);
  }
  function flashInput() {
    const el = document.getElementById('codeInput');
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    el.focus(); el.select();
  }

  function renderDateBar(dailyData, minuteDate, onPick) {
    const bar = document.getElementById('dateBar');
    bar.innerHTML = '';
    if (minuteDate) {
      const exists = dailyData.days.some((d) => d.date === minuteDate);
      if (!exists) {
        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'date-chip today active';
        todayBtn.dataset.date = minuteDate;
        todayBtn.dataset.mode = 'minute';
        const dt = new Date(minuteDate + 'T00:00:00');
        const md = pad(dt.getMonth() + 1) + '/' + pad(dt.getDate());
        todayBtn.innerHTML = '<span class="date-md">' + md + '</span>' +
          '<span class="date-wk">今日</span>' +
          '<span class="date-flow">分时</span>';
        todayBtn.title = minuteDate + ' 分时';
        todayBtn.addEventListener('click', () => onPick(minuteDate, 'minute'));
        bar.appendChild(todayBtn);
      }
    }
    const days = [...dailyData.days].sort((a, b) => b.date.localeCompare(a.date));
    days.forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-chip' + (d.date === minuteDate ? ' active' : '');
      btn.dataset.date = d.date;
      const dt = new Date(d.date + 'T00:00:00');
      const md = pad(dt.getMonth() + 1) + '/' + pad(dt.getDate());
      const wk = ['S','M','T','W','T','F','S'][dt.getDay()];
      const mainColor = d.mainForce >= 0 ? 'var(--c-zl)' : 'var(--c-sh)';
      btn.innerHTML = '<span class="date-md">' + md + '</span>' +
        '<span class="date-wk">' + wk + '</span>' +
        '<span class="date-flow" style="color:' + mainColor + '">' + fmtYiVal(d.mainFlowYi) + '</span>';
      btn.title = d.date + '  主力净流入 '
        + fmtYiVal(d.mainFlowYi) + '（Y = 亿元）';
      btn.addEventListener('click', () => onPick(d.date, 'daily'));
      bar.appendChild(btn);
    });
  }

  function highlightDateChip(dateStr) {
    document.querySelectorAll('.date-chip').forEach((el) => {
      el.classList.toggle('active', el.dataset.date === dateStr);
    });
  }

  let context = {
    code: null, dailyData: null, minuteData: null,
    minuteDate: null, klineData: null, marketOverride: undefined,
  };

  async function loadStock(rawCode, opts) {
    opts = opts || {};
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) { showBanner('error', '请输入股票代码', 3000); flashInput(); return; }
    if (!/^[0-9A-Z]{1,6}$/.test(code)) {
      showBanner('error', '代码格式无效：' + rawCode, 4000);
      flashInput();
      return;
    }

    setStatus('loading', '加载中');
    hideBanner();

    try {
      const [minuteData, dailyData, quote, klineData] = await Promise.all([
        fetchMinuteFlow(code, { marketOverride: opts.marketOverride }),
        fetchDailyFlow(code, { marketOverride: opts.marketOverride }),
        fetchQuote(code, { marketOverride: opts.marketOverride }).catch((e) => {
          console.warn('[quote]', e);
          return null;
        }),
        fetchKline(code, { marketOverride: opts.marketOverride }).catch((e) => {
          console.warn('[kline]', e);
          return null;
        }),
      ]);
      context = { code, marketOverride: opts.marketOverride, minuteData, minuteDate: minuteData.date, dailyData, quote, klineData };
      renderMinuteChart(minuteData);
      renderDateBar(dailyData, minuteData.date, (dateStr, mode) => selectDate(dateStr, mode));
      setStatus('ok', '已加载：' + (minuteData.name || minuteData.code) + ' - ' + formatNow());
      document.getElementById('codeInput').value = code;
    } catch (err) {
      console.warn('[fund-flow]', err);
      if (err.code === 'NETWORK') {
        const mockMin = generateMockMinute(code);
        const mockDay = generateMockDaily(code);
        context = { code, marketOverride: opts.marketOverride, minuteData: mockMin,
          minuteDate: mockMin.date, dailyData: mockDay, quote: null, klineData: null };
        renderMinuteChart(mockMin);
        renderDateBar(mockDay, mockMin.date, (dateStr, mode) => selectDate(dateStr, mode));
        setStatus('error', '行情源不可达，已用模拟数据演示');
        showBanner('error', '东方财富 API 当前不可达。页面已用模拟数据渲染图表，稍后可重试。', 6000);
        document.getElementById('codeInput').value = code;
      } else {
        const detail = (err && err.detail) ? '（' + err.detail.split(';')[0] + '）' : '';
        const msg = (err && typeof err.message === 'string' && err.message) ? err.message : ('未找到该代码：' + rawCode);
        setStatus('error', msg);
        showBanner('error', msg + detail, 5000);
        flashInput();
      }
    }
  }

  function selectDate(dateStr, mode) {
    if (!context.dailyData) return;
    highlightDateChip(dateStr);
    const wantMinute = mode === 'minute' || dateStr === context.minuteDate;
    if (wantMinute && context.minuteData) {
      renderMinuteChart(context.minuteData);
      setStatus('ok', context.code + ' - ' + context.minuteDate + ' - 分时');
      return;
    }
    const day = context.dailyData.days.find((d) => d.date === dateStr);
    if (!day) return;
    renderDailyChart(context.dailyData, dateStr);
    setStatus('ok', context.code + ' - ' + dateStr + ' - 多日曲线');
  }

  function formatNow() {
    const d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }


  // ================= detail modal =================
  const DETAIL_FIELDS = 'f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f60,f71,'
    + 'f84,f85,f116,f117,f127,f152,f162,f167,f168,f169,f170,f171';
  const UP_C = '#ff4d4f';
  const DOWN_C = '#19c37d';

  function toNum(v) {
    if (v == null || v === '-') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  function scalePrice(v, digits) {
    const n = toNum(v);
    return n == null ? null : n / Math.pow(10, digits || 2);
  }
  function fmtVolShou(v) {
    if (v == null) return '-';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '\u4ebf\u624b';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '\u4e07\u624b';
    return v.toFixed(0) + '\u624b';
  }
  function fmtAmt(v) {
    if (v == null) return '-';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '\u4ebf';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '\u4e07';
    return v.toFixed(0);
  }
  function fmtShares(v) {
    if (v == null) return '-';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '\u4ebf\u80a1';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '\u4e07\u80a1';
    return v + '\u80a1';
  }
  function emaSeries(arr, n) {
    const k = 2 / (n + 1);
    const out = [];
    let prev = null;
    for (let i = 0; i < arr.length; i++) {
      prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function calcMacd(closes) {
    const ef = emaSeries(closes, 12);
    const es = emaSeries(closes, 26);
    const dif = closes.map((_, i) => ef[i] - es[i]);
    const dea = emaSeries(dif, 9);
    return { dif: dif, dea: dea, bar: dif.map((d, i) => (d - dea[i]) * 2) };
  }

  function parseDetail(raw) {
    const d = (raw && raw.data) || raw || {};
    const dg = parseInt(d.f152, 10);
    const digits = isNaN(dg) ? 2 : dg;
    const div = (v, k) => { const n = toNum(v); return n == null ? null : n / k; };
    return {
      code: d.f57, name: d.f58,
      last: scalePrice(d.f43, digits), high: scalePrice(d.f44, digits),
      low: scalePrice(d.f45, digits), open: scalePrice(d.f46, digits),
      prevClose: scalePrice(d.f60, digits), avg: scalePrice(d.f71, digits),
      upLimit: scalePrice(d.f51, digits), downLimit: scalePrice(d.f52, digits),
      volume: div(d.f47, 1), amount: div(d.f48, 1), outerVol: div(d.f49, 1),
      volumeRatio: div(d.f50, 100), turnover: div(d.f168, 100),
      change: div(d.f169, 100), changePercent: div(d.f170, 100),
      amplitude: div(d.f171, 100),
      totalCap: div(d.f116, 1), floatCap: div(d.f117, 1),
      totalShares: div(d.f84, 1), floatShares: div(d.f85, 1),
      pe: div(d.f162, 100), pb: div(d.f167, 100),
      industry: d.f127 && d.f127 !== '-' ? d.f127 : '',
    };
  }
  function parseTrends(raw) {
    const d = (raw && raw.data) || raw || {};
    return (d.trends || []).map((line) => {
      const p = line.split(',');
      return {
        time: p[0].slice(11) || p[0], close: parseFloat(p[2]),
        high: parseFloat(p[3]), low: parseFloat(p[4]),
        volume: parseFloat(p[5]), avg: parseFloat(p[7]),
      };
    });
  }
  function parseDKline(raw) {
    const d = (raw && raw.data) || raw || {};
    return (d.klines || []).map((line) => {
      const p = line.split(',');
      return {
        date: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]),
        high: parseFloat(p[3]), low: parseFloat(p[4]),
        volume: parseFloat(p[5]), changePercent: parseFloat(p[8]),
      };
    });
  }

  async function fetchDetailSnapshot(code, opts) {
    const markets = (opts && opts.marketOverride !== undefined)
      ? [opts.marketOverride] : detectMarkets(code);
    const errs = [];
    for (const m of markets) {
      const data = await tryProxies([
        (mm, c) => '/api/detail?market=' + mm + '&code=' + c,
        (mm, c) => 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + mm + '.' + c
          + '&fields=' + DETAIL_FIELDS,
      ], m, code);
      if (!data.__error && (data.f58 || data.f57)) return parseDetail(data);
      errs.push('m=' + m + ' ' + data.__error);
    }
    const err = new Error('\u672a\u80fd\u83b7\u53d6\u884c\u60c5\u5feb\u7167');
    err.detail = errs.join('; ');
    throw err;
  }
  async function fetchDetailSeries(code, mode, opts) {
    const markets = (opts && opts.marketOverride !== undefined)
      ? [opts.marketOverride] : detectMarkets(code);
    if (mode === 'minute') {
      for (const m of markets) {
        const data = await tryProxies([
          (mm, c) => '/api/trends?market=' + mm + '&code=' + c + '&ndays=1',
          (mm, c) => 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=' + mm + '.' + c
            + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58'
            + '&iscr=0&iscca=0&ndays=1',
        ], m, code);
        if (!data.__error && (data.trends || []).length) {
          return { rows: parseTrends(data), preClose: toNum(data.preClose) };
        }
      }
      return null;
    }
    const kltMap = { day: ['101', 80], week: ['102', 80], month: ['103', 60] };
    const cfg = kltMap[mode] || kltMap.day;
    for (const m of markets) {
      const data = await tryProxies([
        (mm, c) => '/api/kline?market=' + mm + '&code=' + c + '&klt=' + cfg[0] + '&lmt=' + cfg[1],
        (mm, c) => 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + mm + '.' + c
          + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
          + '&klt=' + cfg[0] + '&fqt=1&end=20991231&lmt=' + cfg[1],
      ], m, code);
      if (!data.__error && (data.klines || []).length) {
        return { rows: parseDKline(data), preClose: null };
      }
    }
    return null;
  }

  const isMinMode = (m) => m === 'minute';

  // Axis ticks get far less room than the quote grid does, so drop the unit
  // suffix and the decimals - "500?" instead of "500.00??".
  function fmtVolAxis(v) {
    if (!v) return '0';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '\u4ebf';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(0) + '\u4e07';
    return String(v);
  }

  function detailGrids(rightPad) {
    const l = 58, r = rightPad;
    return [
      { left: l, right: r, top: 14, height: '44%' },
      { left: l, right: r, top: '61%', height: '12%' },
      { left: l, right: r, top: '77%', height: '14%' },
    ];
  }

  function buildDetailOption(mode, rows, preClose) {
    const isMin = mode === 'minute';
    // Always draw the minute view across the whole session (09:30 -> 15:00) so an
    // in-progress day shows how much is left to trade. Slots that have not traded
    // yet stay null and render nothing.
    let labels = rows.map((r) => (isMin ? r.time : r.date));
    let points = rows;
    if (isMin) {
      const slots = buildTimeSlots();
      const byTime = new Map();
      rows.forEach((r) => byTime.set(r.time, r));
      labels = slots;
      points = slots.map((t) => byTime.get(t) || null);
    }
    const traded = points.filter(Boolean);
    const firstTraded = points.indexOf(traded[0]);
    const closes = traded.map((r) => r.close);
    // close of the previous traded slot, used for the up/down bar colouring
    const prevClose = new Array(points.length).fill(null);
    let walk = null;
    points.forEach((r, i) => {
      prevClose[i] = walk;
      if (r) walk = r.close;
    });
    // The average-price line must widen the y-range too: on an index f58 tracks
    // the constituents, not the index level, so it sits well outside close/hi-lo
    // and would otherwise be clipped off the top of the panel.
    const spanVals = closes.concat(isMin ? traded.map((r) => r.avg) : [])
      .filter((v) => typeof v === 'number' && isFinite(v));
    let lo = Math.min.apply(null, spanVals), hi = Math.max.apply(null, spanVals);
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    lo -= pad; hi += pad;
    const grids = detailGrids(isMin ? 62 : 18);
    const axColor = '#8a93a6';
    const splitColor = { color: '#1d2330', type: 'dashed' };

    const mkX = (gridIndex, showLabel) => ({
      type: 'category', gridIndex: gridIndex, data: labels, boundaryGap: !isMin,
      axisLine: { lineStyle: { color: '#2a3142' } }, axisTick: { show: false },
      axisLabel: showLabel
        ? (isMin
            ? { color: axColor, fontSize: 10, interval: 0,
                // render every tick, then blank out anything off the half hour.
                // 13:00 goes too: it sits one slot past 11:30 (the lunch break is
                // collapsed), so the two labels would print on top of each other.
                formatter: (v) => ((v.slice(3) === '00' || v.slice(3) === '30') && v !== '13:00') ? v : '' }
            : { color: axColor, fontSize: 10, interval: 'auto', hideOverlap: true })
        : { show: false },
      splitLine: { show: false },
      axisPointer: { show: true, label: { show: false }, lineStyle: { color: '#5b6479' } },
    });
    const mkY = (gridIndex, fmt, extra) => Object.assign({
      type: 'value', gridIndex: gridIndex, scale: true, min: lo, max: hi,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: axColor, fontSize: 10, formatter: fmt },
      splitLine: { lineStyle: splitColor },
    }, extra || {});

    // EMAs need a dense series, so run MACD over the traded points only and pad
    // the result back onto the full-day axis
    const macdRaw = calcMacd(closes);
    const seat = new Array(points.length).fill(-1);
    let seatNo = 0;
    points.forEach((r, i) => { if (r) seat[i] = seatNo++; });
    const padMacd = (arr) => seat.map((j) => (j < 0 ? null : arr[j]));
    const macd = { dif: padMacd(macdRaw.dif), dea: padMacd(macdRaw.dea), bar: padMacd(macdRaw.bar) };

    const volData = points.map((r, i) => {
      if (!r) return { value: null };
      return {
        value: r.volume,
        itemStyle: { color: (isMin
          ? (prevClose[i] == null ? r.close >= preClose : r.close >= prevClose[i])
          : r.close >= r.open) ? UP_C : DOWN_C },
      };
    });

    const series = [];
    if (isMin) {
      series.push({
        name: '\u4ef7\u683c', type: 'line',
        data: points.map((r) => (r ? r.close : null)), xAxisIndex: 0, yAxisIndex: 0,
        showSymbol: false, smooth: false, connectNulls: true,
        lineStyle: { width: 1.6, color: '#f0b400' },
        areaStyle: { color: 'rgba(240,180,0,0.10)' },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: '#5b6479', type: 'dashed', width: 1 },
          label: { show: true, position: 'insideStartTop', color: '#5b6479', fontSize: 10,
            formatter: '\u6628\u6536' },
          data: [{ yAxis: preClose }],
        },
        markArea: {
          silent: true,
          data: [[ { xAxis: '11:30', itemStyle: { color: 'rgba(255,255,255,0.03)' } },
                    { xAxis: '13:00' } ]],
          label: { show: true, position: 'insideTop', color: '#5b6479', fontSize: 10,
            formatter: '\u4f11\u5e02' },
        },
      });
      series.push({
        name: '\u5747\u4ef7', type: 'line', data: points.map((r) => (r ? r.avg : null)),
        xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, connectNulls: true,
        lineStyle: { width: 1.2, color: '#4fa8ff' },
      });
    } else {
      series.push({
        name: 'K\u7ebf', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: UP_C, color0: DOWN_C, borderColor: UP_C, borderColor0: DOWN_C },
        data: points.map((r) => [r.open, r.close, r.low, r.high]),
      });
    }
    series.push({
      name: '\u6210\u4ea4\u91cf', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
      barWidth: '60%', data: volData, large: true,
    });
    series.push({
      name: 'MACD', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, barWidth: '55%',
      data: macd.bar.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? UP_C : DOWN_C } })),
    });
    series.push({
      name: 'DIF', type: 'line', xAxisIndex: 2, yAxisIndex: 2,
      data: macd.dif, showSymbol: false, lineStyle: { width: 1.1, color: '#f0b400' },
    });
    series.push({
      name: 'DEA', type: 'line', xAxisIndex: 2, yAxisIndex: 2,
      data: macd.dea, showSymbol: false, lineStyle: { width: 1.1, color: '#4fa8ff' },
    });

    const yRightPct = {
      type: 'value', gridIndex: 0, min: lo, max: hi, position: 'right',
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: axColor, fontSize: 10,
        // The sign has to come from the computed percentage, not from the tick
        // value: every price is >= 0, so keying off `v` prefixed every label '+'.
        formatter: (v) => {
          if (!preClose) return '-';
          const pct = (v - preClose) / preClose * 100;
          return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        } },
      splitLine: { show: false },
    };

    return {
      backgroundColor: 'transparent', animation: false,
      grid: grids,
      legend: { show: false },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(20,24,33,0.95)', borderColor: '#2a3142', borderWidth: 1,
        padding: [8, 12], textStyle: { color: '#e6edf6', fontSize: 12 },
        formatter: (ps) => {
          if (!ps || !ps.length) return '';
          const i = ps[0].dataIndex;
          const r = points[i];
          if (!r) {
            const t = labels[i];
            const state = (t > '11:30' && t <= '13:00') ? '\u4f11\u5e02'
              : (i < firstTraded ? '\u672a\u5f00\u76d8' : '\u65e0\u6210\u4ea4');
            return '<div style="font-weight:600">' + t
              + '  <span style="color:#5b6479">' + state + '</span></div>';
          }
          const dirCls = isMin
            ? (prevClose[i] == null ? r.close >= preClose : r.close >= prevClose[i])
            : r.close >= r.open;
          const col = dirCls ? UP_C : DOWN_C;
          const pct = isMin
            ? ((r.close - preClose) / preClose * 100)
            : (r.changePercent != null ? r.changePercent : 0);
          const head = isMin
            ? '<div style="font-weight:600;margin-bottom:6px">' + r.time + '  <span style="color:' + col + '">'
              + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</span></div>'
            : '<div style="font-weight:600;margin-bottom:6px">' + r.date + '  <span style="color:' + col + '">'
              + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</span></div>';
          const rowsHtml = isMin
            ? ['\u73b0\u4ef7 ' + r.close.toFixed(2), '\u5747\u4ef7 ' + (r.avg == null ? '-' : r.avg.toFixed(2)),
               '\u6210\u4ea4\u91cf ' + fmtVolShou(r.volume)]
            : ['\u5f00 ' + r.open.toFixed(2), '\u6536 ' + r.close.toFixed(2),
               '\u9ad8 ' + r.high.toFixed(2), '\u4f4e ' + r.low.toFixed(2),
               '\u6210\u4ea4\u91cf ' + fmtVolShou(r.volume)];
          const extra = macd.bar[i] == null ? '' :
            '<div style="margin-top:5px;color:#8a93a6;font-size:11px">MACD '
            + macd.bar[i].toFixed(3) + '</div>';
          return head + rowsHtml.map((t) => '<div style="margin:1px 0">' + t + '</div>').join('') + extra;
        },
      },
      xAxis: [mkX(0, false), mkX(1, false), mkX(2, true)],
      yAxis: [
        mkY(0, (v) => v.toFixed(2)),
        { type: 'value', gridIndex: 1, splitNumber: 2,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: axColor, fontSize: 10, formatter: fmtVolAxis },
          splitLine: { show: false } },
        { type: 'value', gridIndex: 2, splitNumber: 3,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: axColor, fontSize: 10, formatter: (v) => v.toFixed(2) },
          splitLine: { lineStyle: splitColor } },
      ].concat(isMin ? [yRightPct] : []),
      series,
    };
  }

  let dChart = null;
  let dState = { code: null, market: undefined, mode: 'minute', quote: null };

  function dirClass(v) {
    if (v == null || isNaN(v)) return '';
    return v > 0 ? 'up' : (v < 0 ? 'down' : '');
  }
  function fillGrid(el, rows) {
    el.innerHTML = rows.map((r) =>
      '<div><dt>' + r[0] + '</dt><dd id="' + (r[3] || '')
      + '" class="' + (r[2] || '') + '">' + r[1] + '</dd></div>'
    ).join('');
  }
  function renderDetailHeader(q) {
    document.getElementById('dName').textContent = q.name || '-';
    document.getElementById('dCode').textContent = q.code || '-';
    const tag = document.getElementById('dIndustry');
    tag.hidden = !q.industry;
    tag.textContent = q.industry || '';
    const last = document.getElementById('dLast');
    const chg = document.getElementById('dChg');
    const cls = dirClass(q.changePercent);
    last.textContent = q.last == null ? '-' : q.last.toFixed(2);
    last.className = 'dlast ' + cls;
    chg.textContent = (q.change == null ? '-' : (q.change > 0 ? '+' : '') + q.change.toFixed(2))
      + '  ' + (q.changePercent == null ? '-' : (q.changePercent > 0 ? '+' : '') + q.changePercent.toFixed(2) + '%');
    chg.className = 'dchg ' + cls;

    const p2 = (v) => (v == null ? '-' : v.toFixed(2));
    // f51/f52 (limit up/down) and f71 (avg) come back as 0 for indices and for
    // sector/ETF tickers, where those concepts don't apply - "0.00" reads as a
    // real quote, so render those as unavailable instead.
    const pz = (v) => (v == null || v === 0 ? '-' : v.toFixed(2));
    fillGrid(document.getElementById('dQuoteGrid'), [
      ['\u4eca\u5f00', p2(q.open)],
      ['\u6700\u9ad8', p2(q.high)],
      ['\u6700\u4f4e', p2(q.low)],
      ['\u6628\u6536', p2(q.prevClose)],
      ['\u5747\u4ef7', pz(q.avg), '', 'dAvg'],
      ['\u6210\u4ea4\u91cf', fmtVolShou(q.volume)],
      ['\u6210\u4ea4\u989d', fmtAmt(q.amount) + '\u5143'],
      ['\u91cf\u6bd4', q.volumeRatio == null ? '-' : q.volumeRatio.toFixed(2)],
      ['\u6362\u624b\u7387', q.turnover == null ? '-' : q.turnover.toFixed(2) + '%'],
      ['\u632f\u5e45', q.amplitude == null ? '-' : q.amplitude.toFixed(2) + '%'],
      ['\u6da8\u505c', pz(q.upLimit), dirClass(q.upLimit && q.last ? q.upLimit - q.last : null)],
      ['\u8dcc\u505c', pz(q.downLimit), q.downLimit && q.last ? 'down' : ''],
    ]);
    fillGrid(document.getElementById('dValGrid'), [
      ['\u603b\u5e02\u503c', fmtAmt(q.totalCap) + '\u5143'],
      ['\u6d41\u901a\u5e02\u503c', fmtAmt(q.floatCap) + '\u5143'],
      ['\u5e02\u76c8\u7387', q.pe ? q.pe.toFixed(2) : '-'],
      ['\u5e02\u51c0\u7387', q.pb ? q.pb.toFixed(2) : '-'],
      ['\u603b\u80a1\u672c', fmtShares(q.totalShares)],
      ['\u6d41\u901a\u80a1\u672c', fmtShares(q.floatShares)],
      ['\u5916\u76d8', fmtVolShou(q.outerVol)],
      ['\u6da8\u8dcc\u989d', q.change == null ? '-' : (q.change > 0 ? '+' : '') + q.change.toFixed(2), dirClass(q.change)],
      ['\u6da8\u8dcc\u5e45', q.changePercent == null ? '-' : (q.changePercent > 0 ? '+' : '') + q.changePercent.toFixed(2) + '%', dirClass(q.changePercent)],
    ]);
  }

  function ensureDetailChart() {
    const el = document.getElementById('dChart');
    if (!dChart) {
      dChart = echarts.init(el, null, { renderer: 'svg' });
    }
    dChart.resize();
    return dChart;
  }

  async function loadDetailSeries(mode) {
    dState.mode = mode;
    document.querySelectorAll('.dtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.klt === mode);
    });
    const mask = document.getElementById('dLoading');
    const showMask = (text, color) => {
      mask.textContent = text;
      mask.style.color = color || '#5b6479';
      mask.hidden = false;
    };
    showMask('\u52a0\u8f7d\u4e2d\u2026');
    try {
      const payload = await fetchDetailSeries(dState.code, mode, { marketOverride: dState.market });
      const rows = payload && payload.rows;
      if (!rows || !rows.length) {
        showMask('\u6682\u65e0\u6570\u636e');
        return;
      }
      let preClose = payload.preClose;
      if (!preClose && dState.quote) preClose = dState.quote.prevClose;
      if (!preClose && rows.length > 1) preClose = rows[rows.length - 2].close;
      if (!preClose) preClose = rows[0].close;
      if (!ensureDetailChart()) { showMask('\u56fe\u8868\u521d\u59cb\u5316\u5931\u8d25', '#ff6b6b'); return; }
      dChart.setOption(buildDetailOption(mode, rows, preClose), true);
      const avgCell = document.getElementById('dAvg');
      if (avgCell && avgCell.textContent === '-' && isMinMode(mode)) {
        const lastAvg = rows[rows.length - 1].avg;
        if (typeof lastAvg === 'number' && isFinite(lastAvg) && lastAvg !== 0) {
          avgCell.textContent = lastAvg.toFixed(2);
        }
      }
      mask.hidden = true;
    } catch (e) {
      console.warn('[detail]', e);
      showMask('\u52a0\u8f7d\u5931\u8d25\uff1a' + ((e && e.message) || e), '#ff6b6b');
    }
  }

  async function openDetail() {
    if (!context.code) return;
    dState.code = context.code;
    dState.market = context.marketOverride;
    const modal = document.getElementById('detailModal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    try {
      const q = await fetchDetailSnapshot(dState.code, { marketOverride: dState.market });
      dState.quote = q;
      renderDetailHeader(q);
    } catch (e) {
      console.warn('[detail-quote]', e);
      document.getElementById('dName').textContent = context.code;
      document.getElementById('dCode').textContent = context.code;
    }
    await loadDetailSeries('minute');
  }

  function closeDetail() {
    document.getElementById('detailModal').hidden = true;
    document.body.style.overflow = '';
  }

  function wireDetail() {
    const nameEl = document.getElementById('infoName');
    nameEl.addEventListener('click', openDetail);
    document.getElementById('detailClose').addEventListener('click', closeDetail);
    document.querySelector('.modal-backdrop').addEventListener('click', closeDetail);
    document.getElementById('dTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.dtab');
      if (!btn) return;
      loadDetailSeries(btn.dataset.klt);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('detailModal').hidden) closeDetail();
    });
    window.addEventListener('resize', () => {
      if (dChart && !document.getElementById('detailModal').hidden) dChart.resize();
    });
  }

  // ---------------- date-chip hover preview ----------------
  // Four zero-centred bars rather than a sparkline: in a card this small what
  // you actually want to read is each line's sign and how its weight compares
  // to the others, and a 15-point line trace reads as noise at that size.
  const CP_W = 400;
  const CP_H = 150;
  const CP_GUTTER = 70;   // kept clear for the value text past the longest bar
  const CP_ROW_H = 26;
  const CP_BAR_H = 18;
  const CP_TOP = 5;

  function cpNiceStep(range, maxTicks) {
    const target = Math.max(2, maxTicks);
    const span = Math.abs(range);
    if (!(span > 0)) return 1;
    for (let e = -12; e <= 12; e++) {
      for (const m of [1, 2, 2.5, 5, 10]) {
        const step = m * Math.pow(10, e);
        if (span / step <= target) return step;
      }
    }
    return span / target;
  }
  // every flow value is a yuan amount, so the axis and the bars read in ?
  function cpYi(v) {
    return (v / 1e8).toFixed(2) + 'Y';
  }

  function buildFlowBarsSVG(day) {
    const bars = FLOW_SERIES.map((f) => {
      const n = Number(day && day[f.src]);
      return { color: f.color, v: (typeof n === 'number' && isFinite(n)) ? n : 0 };
    });
    let lo = 0, hi = 0;
    for (const b of bars) { if (b.v < lo) lo = b.v; if (b.v > hi) hi = b.v; }
    let mag = Math.max(-lo, hi);
    if (!(mag > 0)) { lo = -1; hi = 1; }
    const slack = mag * 0.08;
    lo -= slack; hi += slack;

    const plotX = 5;
    const plotW = CP_W - CP_GUTTER - plotX;
    const X = (v) => plotX + ((v - lo) / (hi - lo)) * plotW;
    const zeroX = X(0);
    const bodyH = bars.length * CP_ROW_H;

    let out = '<svg class="cp-spark" viewBox="0 0 ' + CP_W + ' ' + CP_H
      + '" width="' + CP_W + '" height="' + CP_H + '">';

    // ~46px between ticks: dense enough to read a bar's position, sparse enough
    // that the labels never collide at 400px wide
    const step = cpNiceStep(hi - lo, Math.floor(plotW / 46));
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 0.001; t += step) {
      const x = X(t).toFixed(1);
      out += '<line class="cp-rule" x1="' + x + '" y1="' + CP_TOP + '" x2="' + x
        + '" y2="' + (CP_TOP + bodyH) + '"/>'
        + '<text class="cp-tick" x="' + x + '" y="' + (CP_H - 5) + '">' + cpYi(t) + '</text>';
    }
    out += '<line class="cp-zero" x1="' + zeroX.toFixed(1) + '" y1="' + (CP_TOP - 3)
      + '" x2="' + zeroX.toFixed(1) + '" y2="' + (CP_TOP + bodyH) + '"/>';

    bars.forEach((b, i) => {
      const y = CP_TOP + i * CP_ROW_H + (CP_ROW_H - CP_BAR_H) / 2;
      const vx = X(b.v);
      const x = Math.min(zeroX, vx);
      const w = Math.max(2, Math.abs(vx - zeroX));
      // value text always sits just past the bar's right edge
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1)
        + '" height="' + CP_BAR_H + '" rx="2" fill="' + b.color + '"/>'
        + '<text class="cp-bar-label" x="' + (x + w + 6).toFixed(1) + '" y="'
        + (y + CP_BAR_H - 3).toFixed(1) + '" fill="' + b.color + '">'
        + (b.v > 0 ? '+' : '') + cpYi(b.v) + '</text>';
    });
    return out + '</svg>';
  }

  function previewRowsFor(dateStr, mode) {
    if (mode === 'minute') {
      const min = context.minuteData;
      if (!min || !min.points || !min.points.length) return { rows: [], sel: 0, note: '\u5206\u65f6' };
      const step = Math.max(1, Math.ceil(min.points.length / 48));
      const rows = [];
      for (let i = 0; i < min.points.length; i += step) {
        const p = min.points[i];
        rows.push({ superLarge: p.superLarge, large: p.large, medium: p.medium, small: p.small });
      }
      const lastP = min.points[min.points.length - 1];
      rows.push({ superLarge: lastP.superLarge, large: lastP.large, medium: lastP.medium, small: lastP.small });
      return { rows: rows, sel: rows.length - 1, note: '\u5f53\u65e5\u5206\u65f6' };
    }
    const days = ((context.dailyData && context.dailyData.days) || [])
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const sel = days.findIndex((d) => d.date === dateStr);
    if (sel < 0) return { rows: [], sel: -1, note: '' };
    return { rows: days, sel: sel, note: '\u8fd1 ' + days.length + ' \u4e2a\u4ea4\u6613\u65e5' };
  }

  function chipPreviewHTML(dateStr, mode) {
    const { rows, sel, note } = previewRowsFor(dateStr, mode);
    if (!rows.length) return null;
    const day = rows[sel] || rows[rows.length - 1];
    const pct = lookupChangePercent(dateStr);
    const cls = pct == null ? 'flat' : (pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat'));
    const pctText = pct == null ? '\u2014' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
    return '<div class="cp-head"><span class="cp-date">' + dateStr
      + '</span><span class="cp-chg ' + cls + '">' + pctText + '</span></div>'
      + buildFlowBarsSVG(day)
      + (note ? '<div class="cp-note">' + note + ' \u00b7 \u79fb\u5f00\u81ea\u52a8\u5173\u95ed</div>' : '');
  }

  let previewTimer = null;
  function placeChipPreview(chip) {
    const pv = document.getElementById('chipPreview');
    const rect = chip.getBoundingClientRect();
    const w = pv.offsetWidth, h = pv.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = rect.bottom + 8;
    // flip above when there is no room underneath
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    pv.style.left = Math.round(left) + 'px';
    pv.style.top = Math.round(top) + 'px';
  }
  function hideChipPreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    document.getElementById('chipPreview').classList.remove('show');
  }
  function showChipPreview(chip) {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    const pv = document.getElementById('chipPreview');
    const dateStr = chip.dataset.date;
    const mode = chip.dataset.mode === 'minute' ? 'minute' : 'daily';
    const html = chipPreviewHTML(dateStr, mode);
    if (!html) { hideChipPreview(); return; }
    pv.innerHTML = html;
    pv.hidden = false;
    placeChipPreview(chip);
    // next frame so the opacity transition actually runs
    requestAnimationFrame(() => pv.classList.add('show'));
  }
  function wireChipPreview() {
    const bar = document.getElementById('dateBar');
    bar.addEventListener('mouseover', (e) => {
      const chip = e.target.closest('.date-chip');
      if (!chip) return;
      previewTimer = setTimeout(() => showChipPreview(chip), 90);
    });
    bar.addEventListener('mouseout', (e) => {
      const chip = e.target.closest('.date-chip');
      if (!chip || chip.contains(e.relatedTarget)) return;
      previewTimer = setTimeout(hideChipPreview, 130);
    });
    // click / scroll / Esc all dismiss; the popup is purely informational
    bar.addEventListener('click', hideChipPreview);
    window.addEventListener('scroll', hideChipPreview, true);
    window.addEventListener('resize', hideChipPreview);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideChipPreview(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureChart();
    const input = document.getElementById('codeInput');
    const btn = document.getElementById('loadBtn');
    btn.addEventListener('click', () => loadStock(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadStock(input.value); });
    document.querySelectorAll('.quick-bar button').forEach((b) => {
      b.addEventListener('click', () => {
        const code = b.dataset.code;
        const marketOverride = b.dataset.market;
        if (marketOverride !== undefined) {
          loadStock(code, { marketOverride: parseInt(marketOverride, 10) });
        } else {
          loadStock(code);
        }
      });
    });
    wireDetail();
    wireChipPreview();
    loadStock('000001');
  });
})();
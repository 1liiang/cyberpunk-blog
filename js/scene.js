/* 场景氛围：三类背景均在内容下方。旧偏好在读取时归并，数据键保持兼容。 */
(function () {
  'use strict';

  var ATMO_ALL = ['glow', 'grid', 'stardust'];
  var ATMO_STATIC = ['glow', 'grid'];
  var MODE_KEY = 'neon_atmo_mode';
  var MANUAL_KEY = 'neon_atmo_manual';
  var LEGACY_LAYERS = {
    glow: 'glow', bloom: 'glow', grid: 'grid', noise: 'grid', scanline: 'grid',
    stardust: 'stardust'
  };
  var SCENES = {
    tower: { atmo: ATMO_ALL }, archive: { atmo: ATMO_STATIC },
    bands: { atmo: ATMO_STATIC }, scanner: { atmo: ATMO_STATIC },
    stash: { atmo: ATMO_STATIC }, idcard: { atmo: ATMO_ALL },
    reading: { atmo: ATMO_STATIC }, console: { atmo: ATMO_STATIC },
    gate: { atmo: ATMO_STATIC }, workshop: { atmo: ATMO_STATIC },
    lost: { atmo: ATMO_STATIC }
  };
  var ROUTE_MAP = {
    home: 'tower', archive: 'archive', tags: 'bands', search: 'scanner',
    marks: 'stash', about: 'idcard', post: 'reading', admin: 'console',
    tagadmin: 'console', login: 'gate', edit: 'workshop'
  };

  /* 片假名雨只挂在既有 stardust 层：固定字符、固定列位，避免每帧随机与
     视线中心堆叠。真正需要这层时才建节点；标准档与内页不付 DOM 成本。 */
  var KANA_STREAMS = [
    'ネオﾝ01カタナ7シグナル',
    'ユメ02ホシノコエ9リンク',
    'ミライ03アオイヒカリ4ログ',
    'シグナル04ネオンカナ8ソラ',
    'デンパ05ユラグキオク2コード',
    'カナタ06ツキアカリ5データ',
    'ヒカリ07ヨルノマチ1メモリ',
    'アーカイブ08ココロ6スキャン',
    'ソラ09ヒカリノナミ3シグナル',
    'ネオン10ツナグセカイ7コエ',
    'ホシ11カナデルユメ4リンク',
    'データ12ユラグヒカリ8ログ',
    'ミライ13ヨルノソラ6コード',
    'ココロ14アオイデンパ2メモリ'
  ];
  function ensureKanaStreams() {
    var layer = document.querySelector('.atmo-layer[data-layer="stardust"]');
    if (!layer || layer.querySelector('.kana-stream')) return;
    var frag = document.createDocumentFragment();
    KANA_STREAMS.forEach(function (seed, streamIndex) {
      var stream = document.createElement('span');
      stream.className = 'kana-stream kana-stream-' + streamIndex;
      stream.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(seed, function (ch, charIndex) {
        var glyph = document.createElement('b');
        glyph.textContent = ch;
        glyph.style.setProperty('--kana-char-delay', (charIndex * 0.13 + streamIndex * 0.07).toFixed(2) + 's');
        stream.appendChild(glyph);
      });
      frag.appendChild(stream);
    });
    layer.appendChild(frag);
  }

  /* pollution 是旧存储值，界面显示为「梦游」；首访与脏值默认「标准」。 */
  function readMode() {
    try {
      var m = window.localStorage.getItem(MODE_KEY);
      return (m === 'pollution' || m === 'silent') ? m : 'standard';
    } catch (e) { return 'standard'; }
  }
  function normalizeLayers(arr) {
    var mapped = arr.map(function (id) {
      return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_LAYERS, id)
        ? LEGACY_LAYERS[id] : null;
    });
    return ATMO_ALL.filter(function (id) { return mapped.indexOf(id) !== -1; });
  }
  function readManual() {
    try {
      var raw = window.localStorage.getItem(MANUAL_KEY);
      var arr = JSON.parse(raw);
      if (Object.prototype.toString.call(arr) !== '[object Array]') return null;
      var list = normalizeLayers(arr);
      var normalized = JSON.stringify(list);
      if (raw !== normalized) {
        try { window.localStorage.setItem(MANUAL_KEY, normalized); } catch (e2) { /* 可读不可写仍使用归并值 */ }
      }
      return list; /* 空数组是明确关闭，不回弹到自动档。 */
    } catch (e) { return null; }
  }
  function layersFor(scene, mode) {
    var def = SCENES[scene] || SCENES.lost;
    if (mode === 'silent') return [];
    if (mode === 'pollution') return def.atmo.slice();
    return def.atmo.filter(function (id) { return ATMO_STATIC.indexOf(id) !== -1; });
  }
  var LOW_END_DROP = ['stardust'];
  function lowEndTier() {
    try {
      if (document.documentElement.getAttribute('data-tier') === 'low') return true;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return true;
      var mem = Number(navigator.deviceMemory);
      if (isFinite(mem) && mem > 0 && mem <= 4) return true;
      var cpu = Number(navigator.hardwareConcurrency);
      if (isFinite(cpu) && cpu > 0 && cpu <= 4) return true;
    } catch (e) { /* 使用静态兜底 */ }
    return false;
  }
  function trimForTier(list) {
    if (!lowEndTier()) return list;
    return list.filter(function (id) { return LOW_END_DROP.indexOf(id) === -1; });
  }
  function effectiveLayers(scene) {
    var manual = readManual();
    var allowed = (SCENES[scene] || SCENES.lost).atmo;
    var list = manual !== null ? manual.filter(function (id) { return allowed.indexOf(id) !== -1; })
      : layersFor(scene, readMode());
    return trimForTier(list);
  }
  function applyLayers(scene) {
    var layers = effectiveLayers(scene);
    if (layers.indexOf('stardust') !== -1) ensureKanaStreams();
    document.documentElement.setAttribute('data-atmo', layers.join(' '));
    try {
      var A = window.NEONAtmo;
      if (A && typeof A.sync === 'function') A.sync();
    } catch (e) { /* 装饰异常不拖累路由 */ }
  }
  function apply(routeName) {
    var scene = ROUTE_MAP[routeName] || 'lost';
    document.body.setAttribute('data-scene', scene);
    applyLayers(scene);
    return scene;
  }
  function reapply() {
    var scene = document.body.getAttribute('data-scene') || 'lost';
    applyLayers(scene);
    return scene;
  }
  window.NEONScene = {
    SCENES: SCENES, ROUTE_MAP: ROUTE_MAP, ATMO_ALL: ATMO_ALL, ATMO_STATIC: ATMO_STATIC,
    MODE_KEY: MODE_KEY, MANUAL_KEY: MANUAL_KEY, readMode: readMode,
    normalizeLayers: normalizeLayers, readManual: readManual, layersFor: layersFor,
    effectiveLayers: effectiveLayers, apply: apply, reapply: reapply
  };
})();

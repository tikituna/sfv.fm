// The shell around the desk: the composer finds a record or a film in the library, the rail's output pills speak to the
// desk's own output select, the chip and the hero follow the view, and the rail mirrors the connection dot.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var names = { onair: 'On air', library: 'Library', studio: 'Live controls', spotify: 'Spotify', radio: 'Radio' };
  var titles = { onair: 'The Booth', library: 'The Library', studio: 'Live controls', spotify: 'Spotify, at the booth', radio: 'The radio booth' };
  function follow() {
    ['onair', 'library', 'studio', 'spotify', 'radio'].forEach(function (name) {
      var tab = $(name + '-tab'); if (!tab) return;
      if (tab.classList.contains('active')) { var chip = $('view-chip'); if (chip) chip.lastChild.textContent = names[name]; var hero = $('hero-title'); if (hero) hero.textContent = titles[name]; }
    });
  }
  new MutationObserver(follow).observe(document.querySelector('.rows'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  follow();
  var composer = $('composer');
  if (composer) composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('composer-input').value.trim(); if (!q) return;
    if ($('library-tab').classList.contains('active')) {   // in the Library: its own search
      var search = $('search');
      if (search) { search.value = q; var form = search.closest('form'); if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); search.dispatchEvent(new Event('input', { bubbles: true })); }
    } else if (window.sfvRecords) window.sfvRecords.find(q);   // anywhere else: a record, from Spotify, through the radio booth
    $('composer-input').value = '';
  });
  document.querySelectorAll('.quick-link[data-go]').forEach(function (b) { b.addEventListener('click', function () { var t = $(b.dataset.go + '-tab'); if (t) t.click(); }); });
  var select = $('control-target');
  document.querySelectorAll('#output-pills .pill').forEach(function (p) {
    p.addEventListener('click', function () {
      if (select) { select.value = p.dataset.output; select.dispatchEvent(new Event('change', { bubbles: true })); }
      document.querySelectorAll('#output-pills .pill').forEach(function (x) { x.classList.toggle('on', x === p); });
    });
  });
  if (select) select.addEventListener('change', function () { document.querySelectorAll('#output-pills .pill').forEach(function (x) { x.classList.toggle('on', x.dataset.output === select.value); }); });
  var dot = $('connection-dot'), status = $('connection-status');
  function mirror() { var rd = $('rail-dot'), rs = $('rail-status'); if (rd && dot) rd.classList.toggle('connected', dot.classList.contains('connected')); if (rs && status) rs.textContent = status.textContent; }
  if (dot && status) { new MutationObserver(mirror).observe(dot, { attributes: true }); new MutationObserver(mirror).observe(status, { childList: true, characterData: true, subtree: true }); mirror(); }
  var rc = $('rail-connection'); if (rc) rc.addEventListener('click', function () { var t = $('connection-toggle'); if (t) t.click(); });
})();
// The record on the air, in the Spotify view by itself (Sam, 2026-10-31: "i wish i could just see it playing from my
// account"): the DJ's nowplaying.json carries the record's Spotify link; the official embed follows it, and a link
// pasted into the form takes over until the record changes.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var player = $('spotify-player'), now = $('spotify-now'), text = $('spotify-now-text'), form = $('spotify-form');
  if (!player || !now) return;
  var shown = null, manual = false, feed = null;
  function embed(id, label) {
    if (shown === id) return;
    shown = id;
    var frame = document.createElement('iframe');
    frame.src = 'https://open.spotify.com/embed/track/' + id + '?utm_source=sfvfm&theme=0';
    frame.width = '100%'; frame.height = '352'; frame.style.border = '0'; frame.style.borderRadius = '16px';
    frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'; frame.loading = 'lazy'; frame.title = 'Spotify: ' + label;
    player.replaceChildren(frame);
    var clear = $('spotify-clear'); if (clear) clear.hidden = false;
    var msg = $('spotify-message'); if (msg) msg.textContent = 'The record on the air, from the station’s Spotify. Paste another link to look at something else.';
  }
  function feedURL(cb) {
    if (feed) return cb(feed);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { feed = c.nowplaying; cb(feed); })
      .catch(function () { feed = 'https://otto-macmini.tail26a86d.ts.net:8443/nowplaying.json'; cb(feed); });   // the private booth is not under the site
  }
  function tick() {
    feedURL(function (u) {
      fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
        var m = n && n.url && /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(n.url);
        if (!m || !n.title) {   // a spot or a program is on: say so, and the last record stays up until the next one
          if (n && n.program) { text.textContent = 'On the air now: ' + n.program + ' (a program; the records come back after)'; now.hidden = false; }
          return;
        }
        var label = (n.artist ? n.artist + ' – ' : '') + n.title;
        text.textContent = 'On the air now: ' + label; now.hidden = false;
        var sub = document.querySelector('#spotify-tab .sub'); if (sub) sub.textContent = label;
        if (!manual) embed(m[1], label);
        else if (shown !== m[1] && manual === 'until-change') { manual = false; embed(m[1], label); }
      }).catch(function () {});
    });
  }
  if (form) form.addEventListener('submit', function () { manual = 'until-change'; shown = null; });
  var clear = $('spotify-clear'); if (clear) clear.addEventListener('click', function () { manual = false; shown = null; setTimeout(tick, 50); });
  window.sfvBooth = { showTrack: embed };
  tick(); setInterval(tick, 10000);
})();
// The ON AIR sign: lit while the station's /live mount is up (the same check the station page makes), flashing while the
// microphone is open (the mic strip's live class), dark otherwise.
(function () {
  var sign = document.getElementById('onair-sign'), chip = document.getElementById('view-chip'), strip = document.getElementById('mic-strip');
  if (!sign) return;
  var onAir = false, statusURL = null;
  function paint() {
    var mic = !!(strip && (strip.classList.contains('live') || strip.classList.contains('is-live')));
    var state = mic ? 'mic' : onAir ? 'on' : 'off';
    sign.dataset.state = state; sign.setAttribute('aria-label', state === 'mic' ? 'On the air, microphone open' : state === 'on' ? 'On the air' : 'Off the air');
    if (chip) chip.classList.toggle('on', state !== 'off');
  }
  function check() {
    var go = function (u) {
      fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
        var src = s && s.icestats && s.icestats.source; if (src && !Array.isArray(src)) src = [src];
        onAir = !!(src && src.some(function (x) { return /\/live(\.aac)?$/.test(x.listenurl || ''); })); paint();
      }).catch(function () { onAir = false; paint(); });
    };
    if (statusURL) return go(statusURL);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { statusURL = c.status; go(statusURL); })
      .catch(function () { statusURL = 'https://otto-macmini.tail26a86d.ts.net:8443/status-json.xsl'; go(statusURL); });
  }
  if (strip) new MutationObserver(paint).observe(strip, { attributes: true, attributeFilter: ['class'] });
  paint(); check(); setInterval(check, 15000);
})();

// ---- the records, from the radio booth (tools/booth.py over its websocket, the same one booth.html speaks): the record on
// the air with its art, Previous / Play / Next with the chosen fade, Up next, a Spotify search from the composer with Play
// now and Up next on each find, and My playlists. The booth password is the one the library remembers (sfv-booth-key), or
// the one typed into the connection form, kept only in memory. Nothing here touches the broadcast until a button is pressed.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var strip = $('records'); if (!strip) return;
  var ws = null, url = null, key = null, busy = false, timer = null, statusTimer = null, retry = null, rec = null, takeover = null;
  var msg = $('rec-msg'), title = $('rec-title'), artist = $('rec-artist'), art = $('rec-art'), pp = $('rec-pp');
  var buttons = ['rec-prev', 'rec-pp', 'rec-next'].map($);
  function say(text, error) { msg.textContent = text || ''; msg.classList.toggle('is-error', !!error); }
  function readKey() { try { return localStorage.getItem('sfv-booth-key') || ''; } catch (e) { return ''; } }
  function boothURL(cb) {
    if (url) return cb(url);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { url = c.booth; cb(url); })
      .catch(function () { url = 'wss://otto-macmini.tail26a86d.ts.net:10000/booth'; cb(url); });
  }
  function enable() { var up = !!(ws && ws.readyState === 1); buttons.forEach(function (b) { b.disabled = !up || busy || !!takeover; }); }
  // the air: nowplaying.json, the DJ's word on what the encoder carries (a record, a spot or a program), every 3 s from the
  // moment the page opens; Spotify's own state (rec, from the booth) gives a record's position, and a second line when the
  // air is something else and Spotify is waiting
  var air = null, airURL = null, wait = $('rec-wait'), timeBox = $('rec-time'), pos = $('rec-pos'), dur = $('rec-dur'), fill = $('rec-fill');
  function mmss(x) { x = Math.max(0, Math.round(x || 0)); var h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), s = x % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
  function paintAir() {
    var a = air, r = rec, now = Date.now() / 1000;
    strip.classList.remove('program', 'spot', 'record', 'off');
    if (!a) { title.textContent = 'Reading the air\u2026'; artist.textContent = ''; art.hidden = true; timeBox.hidden = true; wait.hidden = true; return; }
    if (a.program) {
      strip.classList.add('program'); title.textContent = a.program; artist.textContent = 'A program' + (a.program_credit ? ' \u00b7 ' + a.program_credit : ''); art.hidden = true;
      var e = a.program_at ? now - a.program_at : 0; timeBox.hidden = false; pos.textContent = mmss(e); dur.textContent = mmss(a.program_secs); fill.style.width = a.program_secs ? Math.min(100, 100 * e / a.program_secs) + '%' : '0%';
    } else if (a.spot) {
      strip.classList.add('spot'); title.textContent = a.spot; artist.textContent = 'A word from the Valley: a spot between records'; art.hidden = true;
      var es = a.spot_at ? now - a.spot_at : 0; timeBox.hidden = false; pos.textContent = mmss(es); dur.textContent = ''; fill.style.width = '100%';
    } else if (a.title) {
      strip.classList.add('record'); title.textContent = a.title; artist.textContent = (a.artist || '') + (a.album ? ' \u00b7 ' + a.album : '');
      if (a.art) { art.src = a.art; art.hidden = false; } else art.hidden = true;
      if (r && r.dur && r.title === a.title) { timeBox.hidden = false; pos.textContent = mmss(r.pos); dur.textContent = mmss(r.dur); fill.style.width = Math.min(100, 100 * r.pos / r.dur) + '%'; }
      else timeBox.hidden = true;
    } else { strip.classList.add('off'); title.textContent = a.live === false ? 'Off the air' : 'Nothing on the air'; artist.textContent = ''; art.hidden = true; timeBox.hidden = true; }
    // Spotify's own state, when it is not what the air carries
    if (r && r.title && !(a.title && r.title === a.title)) { wait.textContent = 'Spotify: ' + r.title + ', ' + r.artist + ', ' + (r.state === 'playing' ? 'playing' : 'paused') + (r.dur ? ' at ' + mmss(r.pos) : '') + (a.program || a.spot ? ' \u00b7 the records come back after' : ''); wait.hidden = false; }
    else if (r && !r.title && r.state === 'not running') { wait.textContent = 'Spotify is not running on the station.'; wait.hidden = false; }
    else wait.hidden = true;
    pp.classList.toggle('playing', !!(r && r.state === 'playing'));
  }
  function pollAir() {
    var go = function (u) { fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (n) { air = n; paintAir(); }).catch(function () {}); };
    if (airURL) return go(airURL);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (c) { airURL = c.nowplaying; go(airURL); })
      .catch(function () { airURL = 'https://otto-macmini.tail26a86d.ts.net:8443/nowplaying.json'; go(airURL); });
  }
  pollAir(); setInterval(pollAir, 3000);
  setInterval(function () { if (rec && rec.state === 'playing' && air && air.title === rec.title) { rec.pos = (rec.pos || 0) + 1; paintAir(); } }, 1000);   // the second hand between answers
  function show(r) { rec = r || null; paintAir(); }
  function showUpNext(u) { var box = $('rec-upnext'); if (!u || !u.uri) { box.hidden = true; return; } $('rec-upnext-name').textContent = (u.name || u.uri) + (u.by ? ', ' + u.by : ''); box.hidden = false; }
  function connect() {
    key = key || readKey();
    if (!key) { say('Sign in with the booth password to work the records.'); var b = document.createElement('button'); b.type = 'button'; b.className = 'text-button'; b.textContent = 'Sign in'; b.addEventListener('click', function () { var t = $('connection-toggle'); if (t) t.click(); var p = $('password'); if (p) p.focus(); }); msg.append(' ', b); return; }
    boothURL(function (u) {
      try { ws = new WebSocket(u + '?k=' + encodeURIComponent(key)); } catch (e) { say('Could not reach the booth.', true); return; }
      ws.onopen = function () { say(''); enable(); ask(); clearInterval(statusTimer); statusTimer = setInterval(ask, 2000); };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'status') { takeover = m.takeover || null; show(m.rec); if (m.upnext !== undefined) showUpNext(m.upnext); if (takeover) say(takeover.who + ' has the station; end the takeover first.'); enable(); }
        if (m.type === 'records') { clearTimeout(timer); busy = false; enable(); if (!m.ok) say(m.msg || 'The booth said no.', true); else say(''); ask(); }
        if (m.type === 'spsearch' || m.type === 'myplaylists') renderFinds(m);
        if (m.type === 'refused') say(m.msg || 'Not allowed from here.', true);
      };
      ws.onclose = function (ev) {
        clearInterval(statusTimer); enable();
        if (ev.code === 4001) { say('The booth password was not accepted.', true); key = null; try { localStorage.removeItem('sfv-booth-key'); } catch (e) {} return; }
        if (ev.code === 4003) { say('Too many wrong passwords from this address; try again in ten minutes.', true); return; }
        say('The booth is away; trying again.'); clearTimeout(retry); retry = setTimeout(connect, 5000);
      };
    });
  }
  function ask() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'status' })); }
  function send(o) {
    if (!ws || ws.readyState !== 1) { say('Not connected to the booth.', true); return false; }
    if (busy) return false;
    if (['play', 'next', 'previous'].indexOf(o.do) >= 0) o.fade_seconds = Number($('rec-fade').value);
    o.type = 'records'; ws.send(JSON.stringify(o)); busy = true; enable();
    timer = setTimeout(function () { busy = false; enable(); say('The booth did not answer in time.', true); }, 15000);
    return true;
  }
  $('rec-prev').addEventListener('click', function () { send({ do: 'previous' }); });
  $('rec-next').addEventListener('click', function () { send({ do: 'next' }); });
  pp.addEventListener('click', function () { send({ do: rec && rec.state === 'playing' ? 'pause' : 'resume' }); });
  $('rec-unqueue').addEventListener('click', function () { send({ do: 'unqueue' }); });
  // the finds
  var finds = $('finds'), list = $('finds-list'), lastQ = '';
  function renderFinds(m) {
    list.replaceChildren(); finds.hidden = false;
    $('finds-title').textContent = m.type === 'myplaylists' ? 'My playlists' : 'Records for \u201c' + (m.q || lastQ) + '\u201d';
    if (!m.ok) { var e = document.createElement('li'); e.className = 'fnote'; e.textContent = m.msg || 'Spotify did not answer.'; list.append(e); return; }
    if (!m.items || !m.items.length) { var n = document.createElement('li'); n.className = 'fnote'; n.textContent = 'Nothing found.'; list.append(n); return; }
    m.items.forEach(function (x) {
      var li = document.createElement('li');
      var pic = x.art ? document.createElement('img') : document.createElement('span'); if (x.art) { pic.src = x.art; pic.alt = ''; } else pic.className = 'noart'; li.append(pic);
      var t = document.createElement('div'); t.className = 'ftext';
      var nm = document.createElement('div'); nm.className = 'fname'; nm.textContent = x.name || x.uri; t.append(nm);
      var by = document.createElement('div'); by.className = 'fby'; by.textContent = [x.kind, x.by, x.tracks ? x.tracks + ' tracks' : ''].filter(Boolean).join(' \u00b7 '); t.append(by); li.append(t);
      var act = document.createElement('div'); act.className = 'fact';
      var now = document.createElement('button'); now.type = 'button'; now.className = 'now'; now.textContent = 'Play now'; now.addEventListener('click', function () { if (send({ do: 'play', link: x.uri })) say('Putting on ' + (x.name || x.uri) + '\u2026'); });
      var next = document.createElement('button'); next.type = 'button'; next.textContent = 'Up next'; next.addEventListener('click', function () { if (send({ do: 'queue', link: x.uri, name: x.name || '', by: x.by || '' })) say('Up next: ' + (x.name || x.uri)); });
      act.append(now, next); li.append(act); list.append(li);
    });
  }
  $('finds-close').addEventListener('click', function () { finds.hidden = true; list.replaceChildren(); });
  function find(q) {
    if (!ws || ws.readyState !== 1) { say('Sign in to the booth to find records.', true); finds.hidden = false; $('finds-title').textContent = 'Records'; list.replaceChildren(); var e = document.createElement('li'); e.className = 'fnote'; e.textContent = 'Not connected to the booth.'; list.append(e); return; }
    lastQ = q; ws.send(JSON.stringify({ type: 'spsearch', q: q })); finds.hidden = false; $('finds-title').textContent = 'Looking\u2026'; list.replaceChildren();
  }
  var mine = $('quick-mine'); if (mine) mine.addEventListener('click', function () { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: 'myplaylists' })); finds.hidden = false; $('finds-title').textContent = 'Looking\u2026'; list.replaceChildren(); } else find(''); });
  // the password typed into the connection form, before the library clears it; kept only in memory
  var form = $('connection-form'); if (form) form.addEventListener('submit', function () { var p = $('password'); if (p && p.value) { key = p.value; if (ws) { try { ws.close(); } catch (e) {} } clearTimeout(retry); setTimeout(connect, 1200); } }, true);
  window.sfvRecords = { find: find, connect: function (u, k) { if (u) url = u; if (k) key = k; if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} } connect(); }, state: function () { return { connected: !!(ws && ws.readyState === 1), rec: rec }; } };
  connect();
})();
// The hour before and the hours ahead: schedule.json (the DJ writes it: the slots, the next due, and the rolling log of
// what went out), every minute. Past: records, spots and programs with their start times. Ahead: each slot that falls in
// the next five hours, with its pool; which one of a pool goes on is the DJ's pick, the one not heard longest.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var past = $('hours-past'), next = $('hours-next'); if (!past || !next) return;
  var url = null, DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function hhmm(d) { return d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).replace(' ', ' ').toLowerCase(); }
  function wall(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '\u202f').toLowerCase(); }   // a date built on Valley wall-clock fields
  function row(when, html, cls) { var li = document.createElement('li'); if (cls) li.className = cls; var t = document.createElement('time'); t.textContent = when; var w = document.createElement('div'); w.className = 'what'; w.innerHTML = html; li.append(t, w); return li; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render(s) {
    var now = Date.now() / 1000;
    var recent = (s.recent || []).filter(function (x) { return now - x.t < 3600 * 1.25; }).slice(-14).reverse();
    past.replaceChildren();
    if (!recent.length) past.append(row('', '<span class="kind">Nothing in the log yet.</span>', 'hour-empty'));
    recent.forEach(function (x, i) { past.append(row(hhmm(new Date(x.t * 1000)), '<b>' + esc(x.title) + '</b>' + (x.kind !== 'record' ? ' <span class="kind">· ' + (x.kind === 'spot' ? 'spot' : 'program') + '</span>' : ''), i === 0 ? 'now' : '')); });
    // ahead: the slots in the next five hours, in Valley time
    var la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })); var items = [];
    (s.slots || []).forEach(function (sl) {
      var p = sl.at.split(':'), h = +p[0], m = +p[1];
      for (var d = 0; d < 2; d++) {
        var t = new Date(la); t.setDate(la.getDate() + d); t.setHours(h, m, 0, 0);
        var diff = (t - la) / 1000; if (diff < -600 || diff > 5 * 3600) continue;
        var day = DAYS[(t.getDay() + 6) % 7]; if (sl.days.indexOf('daily') < 0 && sl.days.indexOf(day) < 0) continue;
        items.push({ t: t, slot: sl });
      }
    });
    items.sort(function (a, b) { return a.t - b.t; }); next.replaceChildren();
    if (!items.length) next.append(row('', '<span class="kind">Records all the way for the next five hours.</span>', 'hour-empty'));
    items.forEach(function (x) {
      var titles = x.slot.programs.map(function (p) { return p.title; }); var n = titles.length;
      var html = n === 1 ? '<b>' + esc(titles[0]) + '</b>' : '<b>One of ' + n + ', the one heard longest ago</b><br><span class="kind">' + esc(titles.slice(0, 3).join(' · ')) + (n > 3 ? ' · and ' + (n - 3) + ' more' : '') + '</span>';
      if (s.next && s.next.id && x.slot.programs.some(function (p) { return p.id === s.next.id; }) && Math.abs(new Date(s.next.when) - x.t) < 60000) html = '<b>' + esc(s.next.title) + '</b>' + (n > 1 ? ' <span class="kind">· next of ' + n + '</span>' : '');
      next.append(row(wall(x.t), html));
    });
  }
  function load() {
    var go = function (u) { fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(render).catch(function () {}); };
    if (url) return go(url);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { url = c.schedule; go(url); })
      .catch(function () { url = 'https://otto-macmini.tail26a86d.ts.net:8443/schedule.json'; go(url); });
  }
  load(); setInterval(load, 60000);
})();
// Listen, in the booth: the station's own stream (live.json, the AAC on Apple), a volume remembered on this browser. Never on
// the transmitter itself: a browser that can reach the local Icecast is the station, and its speakers would feed the air.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var btn = $('listen'), el = $('listen-el'), vol = $('listen-vol'), label = $('listen-label'); if (!btn || !el) return;
  var cfg = null, apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
  var v = 0.8; try { var sv = localStorage.getItem('sfv-booth-volume'); if (sv !== null && isFinite(+sv)) v = Math.max(0, Math.min(1, +sv)); } catch (e) {}
  function paintVol() { el.volume = v; vol.value = Math.round(v * 100); vol.style.setProperty('--v', Math.round(v * 100) + '%'); }
  paintVol();
  vol.addEventListener('input', function () { v = vol.value / 100; paintVol(); try { localStorage.setItem('sfv-booth-volume', String(v)); } catch (e) {} });
  function config(cb) {
    if (cfg) return cb(cfg);
    fetch('../../live.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { cfg = c; cb(cfg); })
      .catch(function () { cfg = { stream: 'https://otto-macmini.tail26a86d.ts.net:8443/live', stream_aac: 'https://otto-macmini.tail26a86d.ts.net:8443/live.aac' }; cb(cfg); });
  }
  function set(on, text) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); label.textContent = text || (on ? 'Listening' : 'Listen'); }
  function stop() { try { el.pause(); } catch (e) {} el.removeAttribute('src'); try { el.load(); } catch (e) {} set(false); }
  function start() {
    config(function (c) {
      var u = (apple && c.stream_aac) || c.stream; if (!u) { set(false, 'No stream address'); return; }
      el.src = u + '?t=' + Date.now(); el.volume = v; set(false, 'Tuning…');
      var p = el.play(); if (p && p.then) p.then(function () { set(true); }).catch(function () { set(false, 'Could not play here'); });
    });
  }
  btn.addEventListener('click', function () { if (btn.getAttribute('aria-pressed') === 'true') stop(); else start(); });
  el.addEventListener('playing', function () { set(true); });
  el.addEventListener('pause', function () { if (btn.getAttribute('aria-pressed') === 'true') set(false, 'Stopped'); });
  el.addEventListener('error', function () { if (btn.getAttribute('aria-pressed') === 'true') set(false, 'The stream dropped'); });
  // the studio guard: a browser that can reach the local Icecast is on the transmitter
  fetch('http://127.0.0.1:8000/status-json.xsl', { mode: 'no-cors', cache: 'no-store' }).then(function () { btn.disabled = true; label.textContent = 'This is the transmitter'; }).catch(function () {});
})();

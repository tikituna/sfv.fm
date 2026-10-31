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
  function show(r) {
    rec = r || null;
    if (!r || !r.title) { title.textContent = r && r.state === 'not running' ? 'Spotify is not running on the station' : 'Nothing on the records'; artist.textContent = ''; art.hidden = true; pp.classList.remove('playing'); return; }
    title.textContent = r.title; artist.textContent = r.artist + (r.album ? ' \u00b7 ' + r.album : '');
    if (r.art) { art.src = r.art; art.hidden = false; } else art.hidden = true;
    pp.classList.toggle('playing', r.state === 'playing');
  }
  function showUpNext(u) { var box = $('rec-upnext'); if (!u || !u.uri) { box.hidden = true; return; } $('rec-upnext-name').textContent = (u.name || u.uri) + (u.by ? ', ' + u.by : ''); box.hidden = false; }
  function connect() {
    key = key || readKey();
    if (!key) { say('Sign in with the booth password to work the records.'); title.textContent = 'The records, from the booth'; var b = document.createElement('button'); b.type = 'button'; b.className = 'text-button'; b.textContent = 'Sign in'; b.addEventListener('click', function () { var t = $('connection-toggle'); if (t) t.click(); var p = $('password'); if (p) p.focus(); }); msg.append(' ', b); return; }
    boothURL(function (u) {
      try { ws = new WebSocket(u + '?k=' + encodeURIComponent(key)); } catch (e) { say('Could not reach the booth.', true); return; }
      ws.onopen = function () { say(''); enable(); ask(); clearInterval(statusTimer); statusTimer = setInterval(ask, 5000); };
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

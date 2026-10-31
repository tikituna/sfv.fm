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
    var q = $('composer-input').value.trim(); var search = $('search');
    $('library-tab').click();
    if (search) { search.value = q; var form = search.closest('form'); if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); search.dispatchEvent(new Event('input', { bubbles: true })); }
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
        if (!m || !n.title) return;   // a spot or a program is on: the last record stays up until the next one
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

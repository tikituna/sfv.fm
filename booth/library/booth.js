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

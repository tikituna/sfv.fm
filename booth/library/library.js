(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PAGE_SIZE = 80;
  var state = { base: '', token: '', items: [], category: '', favoritesOnly: false, page: 0, selected: null, previewSerial: 0, busy: false, requestSerial: 0 };
  var favorites = new Set(readJSON('sfv-library-favorites', []));
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  var thumbnailObserver = null, thumbnailQueue = [], thumbnailActive = 0, thumbnailCache = new Map();
  var micData = null, micOwned = false, micPendingOn = false, micCommandBusy = false, micLoading = false;
  var micPollTimer = null, micHeartbeatTimer = null, micHeartbeatBusy = false, micGeneration = 0;

  function readStored(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function writeStored(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) {} }
  function readJSON(key, fallback) { try { var value = JSON.parse(readStored(key)); return Array.isArray(value) ? value : fallback; } catch (e) { return fallback; } }
  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function count(value) { return Number(value).toLocaleString(); }
  function humanize(value) { return String(value || 'Unsorted').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }); }
  function kindOf(item) { return ['audio', 'video', 'image'].includes(item.kind) ? item.kind : 'other'; }
  function rotationOf(item) { var value = item.rotation; if (Array.isArray(value)) return value.length ? value.join(', ') : ''; if (value === true) return 'In rotation'; if (value === false || !value || value === 'none') return ''; return String(value); }
  function duration(value) { var seconds = Number(value); if (!Number.isFinite(seconds) || seconds <= 0) return '—'; seconds = Math.round(seconds); var hours = Math.floor(seconds / 3600); return (hours ? hours + ':' + String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0'); }
  function bytes(value) { var number = Number(value); if (!Number.isFinite(number) || number < 0 || value == null) return 'Not recorded'; if (!number) return '0 bytes'; var units = ['bytes', 'KB', 'MB', 'GB', 'TB']; var index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1); return (number / Math.pow(1024, index)).toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 }) + ' ' + units[index]; }
  function timestamp(value) { if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; var result = Date.parse(value); return Number.isNaN(result) ? 0 : result; }
  function formatDate(value) { var time = timestamp(value); return time ? new Date(time).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded'; }
  function safeURL(value, base) { if (typeof value !== 'string' || !value.trim()) return ''; try { var url = new URL(value, base || location.href); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch (e) { return ''; } }
  function normalizedBase(value) { var url = new URL(value); if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a full http or https library address without a password or query.'); if (location.protocol === 'https:' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use an https library address with this page.'); return url.href.replace(/\/+$/, ''); }
  function connected(value, text) { $('connection-dot').classList.toggle('connected', value); $('connection-status').textContent = text; $('signout').hidden = !value; $('refresh').disabled = !value || state.busy; }
  function openConnection(focus) { $('connection-panel').hidden = false; $('connection-toggle').setAttribute('aria-expanded', 'true'); if (focus) (state.base ? $('password') : $('server-url')).focus(); }
  function notifyConnection() { document.dispatchEvent(new CustomEvent('sfv-library-connection', { detail: { connected: !!state.token, base: state.base } })); }
  function stopPreview() { state.previewSerial += 1; $('preview').querySelectorAll('audio,video').forEach(function (media) { media.pause(); media.removeAttribute('src'); media.load(); }); $('preview').replaceChildren(); $('download').hidden = true; $('download').removeAttribute('href'); }
  function clearSession(message) { releaseMicKeepalive(); state.token = ''; state.requestSerial += 1; state.items = []; state.selected = null; state.busy = false; thumbnailCache.clear(); thumbnailQueue = []; stopPreview(); if ($('file-dialog').open) $('file-dialog').close(); connected(false, message || 'Not connected'); renderStats(false); renderCategories(); render(); openConnection(false); notifyConnection(); }

  async function request(path, options) {
    if (!state.token) throw new Error('Connect to the library first.');
    var requestToken = state.token;
    var headers = Object.assign({ Authorization: 'Bearer ' + requestToken }, options && options.headers);
    var response;
    try { response = await fetch(state.base + path, Object.assign({}, options, { headers: headers, cache: 'no-store', signal: options && options.signal || AbortSignal.timeout(30000) })); }
    catch (e) { throw new Error('The library is not reachable. Check its address and that the station computer is online.'); }
    if (response.status === 401 || response.status === 403) { if (state.token === requestToken) clearSession('Your session ended. Sign in again.'); throw new Error('Your session ended. Sign in again.'); }
    if (!response.ok) { var detail = ''; try { var problem = await response.json(); detail = problem.error || problem.message || ''; } catch (e) {} var failure = new Error(typeof detail === 'string' && detail ? detail : 'The library could not complete that request (' + response.status + ').'); failure.httpStatus = response.status; throw failure; }
    return response.json();
  }

  async function login(password, remember) {
    var nextBase;
    try { nextBase = normalizedBase($('server-url').value.trim()); } catch (e) { $('connection-message').textContent = e.message; return; }
    if (!password) { $('connection-message').textContent = 'Enter your booth password to connect.'; openConnection(true); return; }
    releaseMicKeepalive();
    var attempt = ++state.requestSerial;
    state.token = '';
    thumbnailCache.clear(); thumbnailQueue = [];
    state.items = []; state.selected = null; state.busy = false; stopPreview();
    if ($('file-dialog').open) $('file-dialog').close();
    renderStats(false); renderCategories(); render(); notifyConnection();
    $('connect-button').disabled = true;
    $('connection-message').textContent = 'Connecting…';
    connected(false, 'Connecting to the station…');
    try {
      var response = await fetch(nextBase + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }), cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'That password was not accepted.' : 'The library could not sign you in (' + response.status + ').');
      var session = await response.json();
      if (!session.token || typeof session.token !== 'string') throw new Error('This address did not return a library session. Check the library address.');
      if (attempt !== state.requestSerial) return;
      state.base = nextBase;
      state.token = session.token;
      writeStored('sfv-library-url', nextBase);
      if (remember) writeStored('sfv-booth-key', password);
      else writeStored('sfv-booth-key', '');
      $('password').value = '';
      $('connection-message').textContent = '';
      $('connection-panel').hidden = true;
      $('connection-toggle').setAttribute('aria-expanded', 'false');
      connected(true, 'Connected to the station');
      notifyConnection();
      await loadCatalog(false);
    } catch (e) {
      if (attempt !== state.requestSerial) return;
      var message = e.name === 'TypeError' || e.name === 'TimeoutError' ? 'The library is not reachable. Check the address and that the station computer is online.' : e.message;
      $('connection-message').textContent = message;
      connected(!!state.token, state.token ? 'Connected · library could not load' : 'Not connected');
      openConnection(false);
    } finally { $('connect-button').disabled = false; }
  }

  async function loadCatalog(refresh) {
    var serial = state.requestSerial;
    state.busy = true;
    $('refresh').disabled = true;
    $('refresh').textContent = refresh ? 'Refreshing…' : 'Loading…';
    $('result-count').textContent = refresh ? 'Checking the files…' : 'Loading the archive…';
    try {
      var data = await request(refresh ? '/api/refresh' : '/api/catalog', refresh ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : undefined);
      var scanWait = 0;
      while (data.scanning && scanWait < 30 && serial === state.requestSerial) {
        $('result-count').textContent = 'Scanning the station’s media folders…';
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
        if (serial !== state.requestSerial) return;
        data = await request('/api/catalog'); scanWait += 1;
      }
      if (serial !== state.requestSerial) return;
      if (data.scan_error) throw new Error(data.scan_error);
      if (!Array.isArray(data.items)) throw new Error('The library returned an incomplete catalog. Try refreshing.');
      state.items = data.items.filter(function (item) { return item && typeof item.id === 'string'; }).map(function (item) { return Object.assign({}, item, { title: String(item.title || item.file || 'Untitled'), category: String(item.category || 'Unsorted'), file: String(item.file || '') }); });
      state.page = 0;
      if (state.category && !state.items.some(function (item) { return item.category === state.category; })) state.category = '';
      renderStats(true); renderCategories(); render();
      var missing = state.items.filter(function (item) { return !item.available; }).length;
      $('catalog-note').textContent = (data.location ? 'Files on ' + data.location + '. ' : '') + 'Catalog checked ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '. ' + (missing ? count(missing) + ' listed ' + (missing === 1 ? 'file is' : 'files are') + ' not available on this computer.' : 'All listed files are available on this computer.');
      if (data.scanning) $('catalog-note').textContent += ' A folder scan is still running; refresh again shortly for new files.';
      if (Array.isArray(data.warnings) && data.warnings.length) $('catalog-note').textContent += ' ' + data.warnings.map(function (warning) { return typeof warning === 'string' ? warning : warning.message || ''; }).filter(Boolean).join(' ');
      connected(true, 'Connected to the station');
    } catch (e) {
      if (serial !== state.requestSerial) return;
      if (!state.items.length) showMessage('The library could not load.', e.message, 'Try again', function () { loadCatalog(false); });
      else $('catalog-note').textContent = 'Refresh failed. Showing the previous catalog. ' + e.message;
      $('result-count').textContent = state.items.length ? count(state.items.length) + ' files · refresh failed' : 'Library unavailable';
      connected(!!state.token, state.token ? 'Connected · catalog needs another try' : 'Not connected');
    } finally { state.busy = false; $('refresh').disabled = !state.token; $('refresh').textContent = '↻ Refresh library'; }
  }

  function renderStats(loaded) { var groups = { audio: 0, video: 0, other: 0 }; state.items.forEach(function (item) { var kind = kindOf(item); groups[kind === 'audio' || kind === 'video' ? kind : 'other'] += 1; }); $('count-all').textContent = loaded ? count(state.items.length) : '—'; $('count-audio').textContent = loaded ? count(groups.audio) : '—'; $('count-video').textContent = loaded ? count(groups.video) : '—'; $('count-images').textContent = loaded ? count(groups.other) : '—'; }
  function renderCategories() {
    var groups = new Map(); state.items.forEach(function (item) { groups.set(item.category, (groups.get(item.category) || 0) + 1); });
    var fragment = document.createDocumentFragment();
    function add(category, title, total) { var button = el('button', 'category' + (state.category === category && !state.favoritesOnly ? ' active' : '')); button.type = 'button'; button.setAttribute('aria-pressed', String(state.category === category && !state.favoritesOnly)); button.append(el('span', '', title), el('span', '', count(total))); button.addEventListener('click', function () { state.category = category; state.favoritesOnly = false; state.page = 0; renderCategories(); render(); }); fragment.append(button); }
    add('', 'All files', state.items.length);
    Array.from(groups.keys()).sort(collator.compare).forEach(function (category) { add(category, humanize(category), groups.get(category)); });
    $('category-list').replaceChildren(fragment);
    $('favorites-only').classList.toggle('active', state.favoritesOnly);
    $('favorites-only').setAttribute('aria-pressed', String(state.favoritesOnly));
    $('favorite-count').textContent = count(state.items.filter(function (item) { return favorites.has(item.id); }).length);
  }
  function filteredItems() {
    var query = $('search').value.trim().toLocaleLowerCase();
    var words = query.split(/\s+/).filter(Boolean);
    var kind = $('kind').value, rotation = $('rotation').value, available = $('available').value;
    var items = state.items.filter(function (item) { return (!state.category || item.category === state.category) && (!state.favoritesOnly || favorites.has(item.id)) && (!kind || kindOf(item) === kind) && (!rotation || !!rotationOf(item) === (rotation === 'yes')) && (!available || !!item.available === (available === 'yes')) && (!words.length || words.every(function (word) { return [item.title, item.file, item.credit, item.category, item.year, item.rights].join(' ').toLocaleLowerCase().includes(word); })); });
    var sort = $('sort').value;
    items.sort(function (a, b) { var delta = 0; if (sort === 'newest' || sort === 'oldest') { var left = timestamp(a.modified), right = timestamp(b.modified); if (!left || !right) delta = left ? -1 : right ? 1 : 0; else delta = sort === 'newest' ? right - left : left - right; } else if (sort === 'longest' || sort === 'shortest') { var aSeconds = Number(a.seconds) || 0, bSeconds = Number(b.seconds) || 0; if (!aSeconds || !bSeconds) delta = aSeconds ? -1 : bSeconds ? 1 : 0; else delta = sort === 'longest' ? bSeconds - aSeconds : aSeconds - bSeconds; } return delta || collator.compare(a.title, b.title); });
    return items;
  }
  function showMessage(title, message, action, handler) { $('table-wrap').hidden = true; $('pagination').hidden = true; var container = $('catalog-message'); container.hidden = false; container.replaceChildren(el('span', 'message-symbol', '↳'), el('h3', '', title), el('p', '', message)); if (action) { var button = el('button', 'outline-button', action); button.type = 'button'; button.addEventListener('click', handler); container.append(button); } }
  function fileIcon(item) {
    var holder = el('span', 'file-icon'); holder.setAttribute('aria-hidden', 'true'); holder.dataset.kind = kindOf(item);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.2');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var paths = { audio: 'M3 10v4m4-7v10m5-13v16m5-13v10m4-7v4', video: 'M8 5.5 19 12 8 18.5Z', image: 'M4 4h16v16H4Zm0 12 5-5 4 4 3-3 4 4M15 8h.01', other: 'M6 3h8l4 4v14H6Zm8 0v5h4' };
    path.setAttribute('d', paths[kindOf(item)]); svg.append(path); holder.append(svg);
    if (item.available && (item.kind === 'video' || item.kind === 'image')) holder.dataset.thumbnailId = item.id;
    return holder;
  }
  function showThumbnail(holder, url) { if (!holder.isConnected) return; var image = el('img'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.addEventListener('error', function () { image.remove(); }); image.src = url; holder.append(image); }
  async function drainThumbnails() {
    while (thumbnailActive < 3 && thumbnailQueue.length && state.token) {
      var holder = thumbnailQueue.shift(); if (!holder.isConnected) continue;
      thumbnailActive += 1;
      (async function (target, serial) {
        try { var data = await request('/api/preview?id=' + encodeURIComponent(target.dataset.thumbnailId)); var url = safeURL(data.thumbnail_url, state.base + '/'); if (url && serial === state.requestSerial) { thumbnailCache.set(target.dataset.thumbnailId, { url: url, time: Date.now() }); showThumbnail(target, url); } }
        catch (e) { /* A thumbnail failure leaves the file's media icon visible. */ }
        finally { thumbnailActive -= 1; drainThumbnails(); }
      }(holder, state.requestSerial));
    }
  }
  function observeThumbnails() {
    if (thumbnailObserver) thumbnailObserver.disconnect(); thumbnailQueue = [];
    if (!('IntersectionObserver' in window)) return;
    thumbnailObserver = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { if (!entry.isIntersecting) return; thumbnailObserver.unobserve(entry.target); var cached = thumbnailCache.get(entry.target.dataset.thumbnailId); if (cached && Date.now() - cached.time < 600000) showThumbnail(entry.target, cached.url); else thumbnailQueue.push(entry.target); }); drainThumbnails(); }, { rootMargin: '120px 0px' });
    $('file-list').querySelectorAll('[data-thumbnail-id]').forEach(function (holder) { thumbnailObserver.observe(holder); });
  }
  function render() {
    if (thumbnailObserver) thumbnailObserver.disconnect(); thumbnailQueue = [];
    $('collection-title').textContent = state.favoritesOnly ? 'Saved files' : state.category ? humanize(state.category) : 'All files';
    if (!state.token) { $('result-count').textContent = 'Connect to load the archive'; showMessage('Your station’s collection.', 'Connect to the library to see the audio, videos and images already on the station computer.', 'Open library connection', function () { openConnection(true); }); return; }
    var items = filteredItems();
    $('result-count').textContent = count(items.length) + (items.length === 1 ? ' file' : ' files') + (items.length !== state.items.length ? ' of ' + count(state.items.length) : '');
    if (!items.length) { showMessage(state.items.length ? 'No files match.' : 'The shelves are empty here.', state.items.length ? 'Try a different search or filter, or look in another collection.' : 'No media files were found on this computer. Check the configured media folders and refresh the library.', state.items.length ? 'Clear filters' : null, resetFilters); return; }
    $('catalog-message').hidden = true; $('table-wrap').hidden = false;
    var pages = Math.ceil(items.length / PAGE_SIZE); state.page = Math.min(state.page, pages - 1);
    var fragment = document.createDocumentFragment();
    items.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).forEach(function (item) {
      var row = el('tr'); var titleCell = el('td'); var title = el('button', 'file-title', item.title); title.type = 'button'; title.addEventListener('click', function () { openDetail(item); });
      var labels = el('span', 'file-labels'); labels.append(title, el('span', 'file-subtitle' + (!item.available ? ' missing' : ''), (!item.available ? 'Missing here · ' : '') + item.file)); var nameCell = el('div', 'file-name-cell'); nameCell.append(fileIcon(item), labels); titleCell.append(nameCell);
      var kindCell = el('td', 'type-column'); kindCell.append(el('span', 'kind-badge', kindOf(item)));
      var lengthCell = el('td', 'duration-column', duration(item.seconds));
      var rotationCell = el('td', 'rotation-column'); var rotation = rotationOf(item); rotationCell.append(el('span', 'rotation-label' + (rotation ? ' in-rotation' : ''), rotation ? 'In rotation' : '—')); if (rotation) rotationCell.title = rotation;
      var saveCell = el('td'); var save = el('button', 'save-button', favorites.has(item.id) ? '★' : '☆'); save.type = 'button'; save.setAttribute('aria-label', (favorites.has(item.id) ? 'Unsave ' : 'Save ') + item.title); save.setAttribute('aria-pressed', String(favorites.has(item.id))); save.addEventListener('click', function () { toggleFavorite(item); }); saveCell.append(save);
      if (item.available && ['audio', 'video'].includes(item.kind)) {
        var playbackActions = el('span', 'file-play-actions');
        ['play_now', 'play_next'].forEach(function (action) {
          var play = el('button', 'file-play-button', action === 'play_now' ? 'Play now' : 'Play next'); play.type = 'button'; play.dataset.controlAction = action; play.dataset.itemId = item.id; play.disabled = !window.sfvControl || !window.sfvControl.can(action); play.setAttribute('aria-label', (action === 'play_now' ? 'Play now: ' : 'Play next: ') + item.title); play.title = 'Changes the station program';
          play.addEventListener('click', function () { if (window.sfvControl) window.sfvControl.play(action, item); }); playbackActions.append(play);
        });
        labels.append(playbackActions);
      }
      row.append(titleCell, kindCell, lengthCell, rotationCell, saveCell); fragment.append(row);
    });
    $('file-list').replaceChildren(fragment);
    observeThumbnails();
    $('pagination').hidden = pages < 2;
    $('page-count').textContent = 'Page ' + (state.page + 1) + ' of ' + count(pages);
    $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page === pages - 1;
  }
  function resetFilters() { $('search').value = ''; $('kind').value = ''; $('rotation').value = ''; $('available').value = ''; state.category = ''; state.favoritesOnly = false; state.page = 0; renderCategories(); render(); }
  function toggleFavorite(item) { if (favorites.has(item.id)) favorites.delete(item.id); else favorites.add(item.id); writeStored('sfv-library-favorites', JSON.stringify(Array.from(favorites))); renderCategories(); render(); if (state.selected) updateDetailSave(); }
  function updateDetailSave() { var saved = favorites.has(state.selected.id); $('detail-save').textContent = saved ? '★ Saved' : '☆ Save file'; $('detail-save').setAttribute('aria-pressed', String(saved)); }
  function metadata(label, value, url) { var row = el('div'); row.append(el('dt', '', label)); var detail = el('dd'); if (url) { var link = el('a', '', value); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.append(link); } else detail.textContent = value; row.append(detail); $('metadata').append(row); }
  async function openDetail(item) {
    stopPreview(); state.selected = item;
    var serial = state.previewSerial;
    $('detail-category').textContent = humanize(item.category);
    $('detail-kind').textContent = kindOf(item) + (item.year ? ' · ' + item.year : '');
    $('detail-title').textContent = item.title;
    $('preview-status').textContent = item.available ? 'Loading preview…' : 'This file is listed in the archive but is not on this computer.';
    $('copy-status').textContent = '';
    updateDetailSave(); $('metadata').replaceChildren(); document.dispatchEvent(new CustomEvent('sfv-library-selection', { detail: { item: item } }));
    metadata('File', item.file || 'Not recorded'); metadata('Collection', humanize(item.category)); metadata('Availability', item.available ? 'Available on this computer' : 'Missing on this computer'); metadata('Size', bytes(item.bytes)); if (item.seconds) metadata('Length', duration(item.seconds)); if (item.year) metadata('Year', String(item.year)); metadata('Modified', formatDate(item.modified)); metadata('Credit', String(item.credit || 'Not recorded')); metadata('Source rights note', String(item.rights || 'Not recorded')); var source = safeURL(item.source_url); if (item.source_url) metadata('Source', String(item.source_url), source); metadata('Rotation', rotationOf(item) || 'Not in rotation'); if (item.schedule) metadata('Schedule', String(item.schedule)); if (item.business) metadata('Business', String(item.business));
    if (!$('file-dialog').open) $('file-dialog').showModal();
    $('close-detail').focus();
    if (!item.available) return;
    try {
      var data = await request('/api/preview?id=' + encodeURIComponent(item.id));
      if (serial !== state.previewSerial) return;
      var url = safeURL(data.url, state.base + '/');
      if (!url) throw new Error('The library did not return a usable file link.');
      var downloadURL = new URL(url); downloadURL.searchParams.set('download', '1');
      $('download').href = downloadURL.href; $('download').download = item.file.split('/').pop(); $('download').textContent = 'Download file ↗'; $('download').hidden = false;
      var kind = kindOf(item), media;
      if (kind === 'audio' || kind === 'video') { media = el(kind); media.controls = true; media.muted = true; media.preload = 'metadata'; if (kind === 'video') { media.playsInline = true; var poster = safeURL(data.thumbnail_url, state.base + '/'); if (poster) media.poster = poster; } media.setAttribute('aria-label', 'Preview of ' + item.title); }
      else if (kind === 'image') { media = el('img'); media.alt = item.title; }
      if (media) { media.src = url; media.addEventListener('error', function () { if (serial === state.previewSerial) $('preview-status').textContent = 'This browser could not preview the file. Try downloading it, or close and reopen it for a fresh link.'; }); $('preview').append(media); }
      $('preview-status').textContent = kind === 'audio' || kind === 'video' ? 'Ready. Press play and unmute to listen on this device.' : kind === 'image' ? 'Image preview.' : 'This file can be downloaded; a preview is not available.';
    } catch (e) { if (serial === state.previewSerial) $('preview-status').textContent = e.message; }
  }

  function selectTab(name) {
    if (!['onair', 'library', 'studio', 'spotify', 'radio'].includes(name)) name = 'onair';
    ['onair', 'library', 'studio', 'spotify', 'radio'].forEach(function (tab) { var active = tab === name; $(tab + '-view').hidden = !active; $(tab + '-tab').classList.toggle('active', active); if (active) $(tab + '-tab').setAttribute('aria-current', 'page'); else $(tab + '-tab').removeAttribute('aria-current'); });
    document.title = ({ onair: 'Control room', library: 'Library', studio: 'Live controls', spotify: 'Spotify preview', radio: 'Radio booth' }[name]) + ' — San Fernando Valley Radio'; updateStudioPolling(); document.dispatchEvent(new CustomEvent('sfv-booth-tab', { detail: { tab: name } }));
  }
  ['onair', 'library', 'studio', 'spotify', 'radio'].forEach(function (name) { $(name + '-tab').addEventListener('click', function () { selectTab(name); }); });
  $('connection-toggle').addEventListener('click', function () { var hidden = !$('connection-panel').hidden; $('connection-panel').hidden = hidden; $('connection-toggle').setAttribute('aria-expanded', String(!hidden)); });
  $('empty-connect').addEventListener('click', function () { openConnection(true); });
  $('connection-form').addEventListener('submit', function (event) { event.preventDefault(); login($('password').value, $('remember-password').checked); });
  $('signout').addEventListener('click', async function () { releaseMicKeepalive(); $('signout').disabled = true; var revoked = false; try { await request('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); revoked = true; } catch (e) {} finally { writeStored('sfv-booth-key', ''); $('password').value = ''; clearSession(revoked ? 'Signed out' : 'Signed out on this browser'); $('catalog-note').textContent = revoked ? '' : 'The server could not be reached to revoke the session. Existing file links expire automatically.'; $('signout').disabled = false; } });
  $('refresh').addEventListener('click', function () { if (!state.busy) loadCatalog(true); });
  document.querySelector('.search-form').addEventListener('submit', function (event) { event.preventDefault(); });
  ['search', 'kind', 'rotation', 'available', 'sort'].forEach(function (id) { $(id).addEventListener(id === 'search' ? 'input' : 'change', function () { state.page = 0; render(); }); });
  $('favorites-only').addEventListener('click', function () { state.favoritesOnly = !state.favoritesOnly; state.category = ''; state.page = 0; renderCategories(); render(); });
  $('previous-page').addEventListener('click', function () { state.page -= 1; render(); $('collection-title').scrollIntoView({ block: 'start' }); });
  $('next-page').addEventListener('click', function () { state.page += 1; render(); $('collection-title').scrollIntoView({ block: 'start' }); });
  $('close-detail').addEventListener('click', function () { $('file-dialog').close(); });
  $('file-dialog').addEventListener('close', stopPreview);
  $('file-dialog').addEventListener('click', function (event) { if (event.target === $('file-dialog')) { var bounds = $('file-dialog').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('file-dialog').close(); } });
  $('detail-save').addEventListener('click', function () { if (state.selected) toggleFavorite(state.selected); });
  $('copy-reference').addEventListener('click', async function () { if (!state.selected) return; var item = state.selected; var reference = item.title + '\n' + item.file + (item.credit ? '\nCredit: ' + item.credit : '') + (item.source_url ? '\nSource: ' + item.source_url : ''); try { await navigator.clipboard.writeText(reference); $('copy-status').textContent = 'Reference copied.'; } catch (e) { $('copy-status').textContent = 'Clipboard access is unavailable. Select the file and credit text below to copy it.'; } });
  document.addEventListener('keydown', function (event) { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && !event.target.isContentEditable && !$('file-dialog').open) { event.preventDefault(); selectTab('library'); $('search').focus(); } });

  var studioTimer = null, studioLoading = false, studioCommandBusy = false, studioData = null;
  var studioButtons = ['start-youtube', 'stop-youtube', 'start-vertical', 'stop-vertical', 'set-scene', 'scene-select'];
  function studioUnavailable(message) { studioData = null; studioButtons.forEach(function (id) { $(id).disabled = true; }); $('studio-status').textContent = message; ['youtube', 'vertical'].forEach(function (name) { $(name + '-status').textContent = 'Status unavailable'; $(name + '-status').classList.remove('live'); $(name + '-detail').textContent = 'No studio status is available.'; }); $('scene-status').textContent = 'Status unavailable'; $('scene-select').replaceChildren(new Option('No scenes available', '')); }
  function renderStudio(data) {
    studioData = data;
    if (!data.connected) { studioUnavailable(data.error || 'The studio is not connected. Check that OBS is running on the station computer.'); return; }
    $('studio-status').textContent = 'Connected to OBS · checked ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    var youtube = data.youtube || {}, vertical = data.vertical || {};
    var youtubeKnown = typeof youtube.active === 'boolean';
    $('youtube-status').textContent = youtubeKnown ? youtube.active ? 'Live' : 'Off air' : 'Status unavailable';
    $('youtube-status').classList.toggle('live', !!youtube.active);
    $('youtube-detail').textContent = youtube.reconnecting ? 'OBS is reconnecting to YouTube.' : youtube.active ? 'Running ' + duration(Number(youtube.duration_ms) / 1000) + (Number.isFinite(youtube.skipped_frames) ? ' · ' + count(youtube.skipped_frames) + ' skipped frames' : '') : 'The main OBS stream is ' + (youtubeKnown ? 'stopped.' : 'not reporting a status.');
    $('start-youtube').disabled = studioCommandBusy || !youtubeKnown || youtube.active;
    $('stop-youtube').disabled = studioCommandBusy || !youtubeKnown || !youtube.active;
    var verticalKnown = vertical.available !== false && typeof vertical.active === 'boolean';
    $('vertical-status').textContent = verticalKnown ? vertical.active ? 'Live' : 'Off air' : 'Unavailable';
    $('vertical-status').classList.toggle('live', verticalKnown && vertical.active);
    $('vertical-detail').textContent = vertical.error || (verticalKnown ? vertical.active ? 'The vertical canvas is streaming.' : 'The vertical canvas is stopped.' : 'The vertical canvas is not available in this OBS connection.');
    $('start-vertical').disabled = studioCommandBusy || !verticalKnown || vertical.active;
    $('stop-vertical').disabled = studioCommandBusy || !verticalKnown || !vertical.active;
    $('scene-status').textContent = data.scene || 'No scene reported';
    var previous = $('scene-select').value;
    var scenes = Array.isArray(data.scenes) ? data.scenes.filter(function (scene) { return typeof scene === 'string'; }) : [];
    $('scene-select').replaceChildren();
    if (!scenes.length) $('scene-select').append(new Option('No scenes available', ''));
    else scenes.forEach(function (scene) { $('scene-select').append(new Option(scene, scene)); });
    $('scene-select').value = scenes.includes(previous) ? previous : data.scene || scenes[0] || '';
    $('scene-select').disabled = studioCommandBusy || !scenes.length;
    $('set-scene').disabled = studioCommandBusy || !scenes.length || $('scene-select').value === data.scene;
  }
  async function loadStudio() {
    if (studioLoading || studioCommandBusy || !state.token || $('studio-view').hidden) return;
    var serial = state.requestSerial;
    studioLoading = true; $('studio-refresh').disabled = true;
    try { var data = await request('/api/studio'); if (serial === state.requestSerial) renderStudio(data); }
    catch (e) { if (serial === state.requestSerial) studioUnavailable(e.message); }
    finally { studioLoading = false; $('studio-refresh').disabled = !state.token || studioCommandBusy; }
  }
  function updateStudioPolling() { clearInterval(studioTimer); studioTimer = null; $('studio-refresh').disabled = !state.token || studioCommandBusy; if (!state.token) { studioUnavailable('Connect to the library to check the studio.'); return; } if (!$('studio-view').hidden && !document.hidden) { loadStudio(); studioTimer = setInterval(loadStudio, 15000); } }
  async function studioCommand(action, value) {
    if (!state.token || studioCommandBusy || !studioData || !studioData.connected) return;
    if (action.startsWith('stop_') && !confirm('Stop the ' + (action === 'stop_youtube' ? 'YouTube' : 'vertical') + ' live stream?')) return;
    if (action === 'set_scene' && !confirm('Switch the main live picture to “' + value + '”?')) return;
    studioCommandBusy = true; studioButtons.forEach(function (id) { $(id).disabled = true; }); $('studio-refresh').disabled = true;
    $('studio-status').textContent = 'Sending the studio command…';
    try { var result = await request('/api/studio/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, value: value }) }); if (result.ok !== true) throw new Error(result.error || 'The studio did not accept the command.'); $('studio-status').textContent = 'Command accepted. Checking the stream status…'; studioCommandBusy = false; await loadStudio(); }
    catch (e) { studioCommandBusy = false; if (studioData) renderStudio(studioData); $('studio-status').textContent = e.message; }
    finally { studioCommandBusy = false; $('studio-refresh').disabled = !state.token; }
  }
  $('studio-refresh').addEventListener('click', loadStudio);
  ['start-youtube', 'stop-youtube', 'start-vertical', 'stop-vertical'].forEach(function (id) { $(id).addEventListener('click', function () { studioCommand(id.replace('-', '_')); }); });
  $('scene-select').addEventListener('change', function () { $('set-scene').disabled = !studioData || studioCommandBusy || $('scene-select').value === studioData.scene; });
  $('scene-form').addEventListener('submit', function (event) { event.preventDefault(); if (!$('set-scene').disabled) studioCommand('set_scene', $('scene-select').value); });
  document.addEventListener('sfv-library-connection', updateStudioPolling);
  document.addEventListener('visibilitychange', updateStudioPolling);

  function stopMicHeartbeat() { clearInterval(micHeartbeatTimer); micHeartbeatTimer = null; }
  function releaseMicKeepalive() {
    if ((micOwned || micPendingOn) && state.token && state.base) {
      fetch(state.base + '/api/mic/off', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' }, body: '{"owned_only":true}', keepalive: true, cache: 'no-store' }).catch(function () {});
    }
    micOwned = false; micPendingOn = false; micCommandBusy = false; micGeneration += 1; stopMicHeartbeat();
  }
  function renderMic(data, message) {
    var live = !!(data && data.on === true), available = !!(data && data.available);
    var canStop = live || micOwned || micPendingOn;
    $('mic-strip').classList.toggle('is-live', live);
    $('mic-toggle').setAttribute('aria-pressed', String(live));
    $('mic-toggle').disabled = !state.token || (!canStop && (micCommandBusy || !available || data && data.sender_ready !== true || data && data.transitioning));
    $('mic-dip').disabled = !state.token || !available || micCommandBusy || !!(data && data.transitioning);
    $('mic-button-text').textContent = canStop ? 'Take off air' : micCommandBusy || data && data.transitioning ? 'Changing…' : 'Go on air';
    $('mic-status').textContent = message || (!state.token ? 'Sign in to control the mic.' : !data ? 'Connecting to the mic…' : data.transitioning ? (live ? 'Fading onto the air…' : 'Fading off the air…') : live ? 'ON AIR · mic route open' : data.sender_ready === false ? 'Open SFV On Air on your Mac' : !available ? data.error || 'Mic unavailable' : data.sender_ready !== true ? 'Off air · sender status unknown' : data.on === false ? 'Ready · off air' : 'Mic status unavailable');
    if (live && !micCommandBusy && data && [0, -6, -10, -14, -20].includes(Number(data.dip_db)) && document.activeElement !== $('mic-dip')) $('mic-dip').value = String(data.dip_db);
  }
  function scheduleMicPoll() { clearTimeout(micPollTimer); if (state.token && !document.hidden) micPollTimer = setTimeout(loadMic, micData && (micData.on || micData.transitioning) ? 2000 : 5000); }
  async function loadMic() {
    if (!state.token || document.hidden || micLoading) return;
    var serial = state.requestSerial, generation = micGeneration;
    micLoading = true;
    try {
      var data = await request('/api/mic', { signal: AbortSignal.timeout(5000) });
      if (serial !== state.requestSerial || generation !== micGeneration) return;
      micData = data;
      if (data.on === false && !data.transitioning && !micPendingOn) { micOwned = false; stopMicHeartbeat(); }
      renderMic(data);
    } catch (e) { if (serial === state.requestSerial && generation === micGeneration) { micData = null; renderMic(null, 'Mic connection unavailable'); } }
    finally { micLoading = false; scheduleMicPoll(); }
  }
  async function micHeartbeat() {
    if (!micOwned || !state.token || micHeartbeatBusy) return;
    var serial = state.requestSerial, generation = micGeneration;
    micHeartbeatBusy = true;
    try { var result = await request('/api/mic/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }); if (result.ok === false) throw new Error(result.error || 'Mic heartbeat failed.'); }
    catch (e) { if (serial === state.requestSerial && generation === micGeneration && micOwned) { releaseMicKeepalive(); micData = null; renderMic(null, 'Connection lost · closing mic route'); } }
    finally { micHeartbeatBusy = false; }
  }
  function startMicHeartbeat() { stopMicHeartbeat(); if (!micOwned) return; micHeartbeat(); micHeartbeatTimer = setInterval(micHeartbeat, 2000); }
  async function setMic(on, emergency) {
    if (!state.token || micCommandBusy && !emergency) return;
    if (on && (!micData || !micData.available || micData.sender_ready !== true)) return;
    var serial = state.requestSerial, generation = ++micGeneration;
    var previouslyOwned = micOwned;
    var requestedDip = Number($('mic-dip').value);
    micCommandBusy = true; micPendingOn = on;
    if (!on) { micOwned = false; stopMicHeartbeat(); }
    renderMic(micData, on ? 'Opening the mic route…' : 'Taking the mic off air…');
    try {
      var result = await request(emergency ? '/api/mic/off' : '/api/mic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emergency ? '{}' : JSON.stringify({ on: on, dip_db: requestedDip }), signal: AbortSignal.timeout(5000) });
      if (serial !== state.requestSerial || generation !== micGeneration) return;
      if (result.ok === false) { var rejected = new Error(result.error || 'The mic command was not accepted.'); rejected.httpStatus = 400; throw rejected; }
      micPendingOn = false; micOwned = on; micCommandBusy = false;
      if (typeof result.on === 'boolean') micData = result;
      if (on) startMicHeartbeat();
      renderMic(micData, 'Command accepted · checking mic status…');
      await loadMic();
    } catch (e) {
      if (serial !== state.requestSerial || generation !== micGeneration) return;
      if (on) { if (e.httpStatus && !previouslyOwned) micPendingOn = false; releaseMicKeepalive(); }
      micPendingOn = false; micCommandBusy = false; micData = null;
      renderMic(null, on ? e.httpStatus ? e.message : 'Could not open the mic. Check SFV On Air.' : 'Off not confirmed · press Esc to retry');
      scheduleMicPoll();
    } finally { if (serial === state.requestSerial && generation === micGeneration) micCommandBusy = false; }
  }
  function updateMicConnection() {
    clearTimeout(micPollTimer);
    if (!state.token) { releaseMicKeepalive(); micData = null; micCommandBusy = false; renderMic(null); return; }
    if (!document.hidden) { renderMic(micData); loadMic(); }
  }
  function toggleMic() { var stop = micOwned || micPendingOn || !!(micData && micData.on === true); setMic(!stop, stop && (micCommandBusy || !!(micData && micData.transitioning))); }
  $('mic-toggle').addEventListener('click', toggleMic);
  $('mic-dip').addEventListener('change', function () { if (micOwned && micData && micData.on === true) setMic(true, false); });
  document.addEventListener('sfv-library-connection', updateMicConnection);
  document.addEventListener('visibilitychange', updateMicConnection);
  window.addEventListener('pagehide', releaseMicKeepalive);
  window.addEventListener('pageshow', updateMicConnection);
  document.addEventListener('keydown', function (event) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !state.token) return;
    if (event.key === 'Escape') { setMic(false, true); return; }
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.target.closest('input, textarea, select, button, a, [contenteditable=true], dialog') || $('file-dialog').open) return;
    event.preventDefault(); if (!$('mic-toggle').disabled) toggleMic();
  });

  // Studio controls can share the authenticated library connection without persisting the session token.
  window.sfvLibrary = { request: request, getBase: function () { return state.base; }, getGeneration: function () { return state.requestSerial; }, isConnected: function () { return !!state.token; }, getSelected: function () { return state.selected; }, selectTab: selectTab };

  async function initialize() {
    var storedBase = readStored('sfv-library-url');
    try {
      if (storedBase) state.base = normalizedBase(storedBase);
      else if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.origin === 'https://otto-macmini.tail26a86d.ts.net:9443' || location.pathname.startsWith('/library/booth/library')) { var marker = location.pathname.indexOf('/booth/library'); state.base = location.origin + (marker >= 0 ? location.pathname.slice(0, marker) : ''); }
      else { var response = await fetch('/live.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error('No station connection found.'); var config = await response.json(); if (config.library) state.base = normalizedBase(config.library); else if (config.booth) { var booth = new URL(config.booth); booth.protocol = booth.protocol === 'wss:' ? 'https:' : booth.protocol === 'ws:' ? 'http:' : booth.protocol; state.base = normalizedBase(booth.origin + '/library'); } }
      $('server-url').value = state.base;
      var password = readStored('sfv-booth-key');
      $('remember-password').checked = !!password;
      if (state.base && password) await login(password, true);
      else { connected(false, state.base ? 'Sign in to control the station' : 'Station address needed'); openConnection(false); }
    } catch (e) { connected(false, 'Station address needed'); $('connection-message').textContent = 'Enter the library address to connect to the station computer.'; openConnection(false); }
  }
  initialize();
}());

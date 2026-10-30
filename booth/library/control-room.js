(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var library = window.sfvLibrary;
  var channelIds = ['program_wide', 'program_tall', 'mic'];
  var current = null, loading = false, commandBusy = false, pollTimer = null, epoch = 0, observedAt = 0;
  var lastCommand = '', commandError = '', pendingPlayout = null, editingLevel = null;

  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function isKnown() { return !!(library.isConnected() && current && current.available === true); }
  function targetNames() { return $('control-target').value === 'all' ? ['wide', 'tall'] : [$('control-target').value]; }
  function outputName(target) { return target === 'wide' ? 'YouTube' : target === 'tall' ? 'Vertical' : 'Both outputs'; }
  function program() {
    var names = targetNames(), reports = names.map(function (name) { return current && current.renderers && current.renderers[name]; });
    // A per-output report is required; a different output must never stand in for this one.
    var available = isKnown() && reports.every(function (report) { return report && report.available === true; });
    var modes = reports.map(function (report) { return report && report.mode === 'manual' ? 'override' : report && report.mode || 'unknown'; });
    var mode = !available ? 'unknown' : modes.includes('transition') ? 'transition' : modes.every(function (value) { return value === modes[0]; }) ? modes[0] : 'mixed';
    var caps = {}; ['play_now', 'play_next', 'return_to_schedule'].forEach(function (action) { caps[action] = available && reports.every(function (report) { return report.capabilities && report.capabilities[action] === true; }); });
    var now = available && reports[0].current || null, queued = [];
    if (available && names.length > 1 && labelFor(reports[0].current) !== labelFor(reports[1].current)) now = { title: 'Different programs on each output', category: 'YouTube: ' + labelFor(reports[0].current) + ' · Vertical: ' + labelFor(reports[1].current) };
    if (available) reports.forEach(function (report, index) { var queue = Array.isArray(report.queued) ? report.queued : report.queued ? [report.queued] : []; queue.forEach(function (item) { queued.push(names.length > 1 ? Object.assign({}, item, { title: outputName(names[index]) + ' · ' + labelFor(item) }) : item); }); });
    var errors = reports.map(function (report, index) { return report && report.error ? outputName(names[index]) + ': ' + report.error : null; }).filter(Boolean);
    return { available: available, mode: mode, now: now, queued: queued, capabilities: caps, error: errors.join(' '), transitioning: mode === 'transition' || !!(current && current.transitioning), can_return: modes.some(function (value) { return value === 'override'; }) };
  }
  function can(action) {
    if (!isKnown() || commandBusy || pendingPlayout || current.transitioning) return false;
    if (action === 'mixer') return !!(current.capabilities && current.capabilities.mixer === true);
    var selected = program();
    return !!(selected.available && !selected.transitioning && selected.mode !== 'unknown' && selected.capabilities[action]);
  }
  function channel(id) { return current && Array.isArray(current.channels) ? current.channels.find(function (item) { return item && item.id === id; }) : null; }
  function fadeSeconds() { var value = Number($('fade-duration').value); return [0, 1, 2, 4].includes(value) ? value : 2; }
  function decibels(value) { return Math.round(value * 10) / 10 === 0 ? '0' : String(Math.round(value * 10) / 10).replace('-', '−'); }
  function finiteDb(value) { return typeof value === 'number' && Number.isFinite(value); }
  function duration(value) { var seconds = Number(value); if (!Number.isFinite(seconds) || seconds <= 0) return ''; return Math.floor(seconds / 60) + ':' + String(Math.round(seconds) % 60).padStart(2, '0'); }
  function labelFor(item) { return item && typeof item.title === 'string' && item.title ? item.title : item && typeof item.file === 'string' ? item.file : 'Untitled file'; }

  function renderActions() {
    $('return-schedule').disabled = !can('return_to_schedule') || !program().can_return;
    $('fade-duration').disabled = commandBusy || !!pendingPlayout || !!(current && current.transitioning);
    $('control-target').disabled = commandBusy || !!pendingPlayout;
    document.querySelectorAll('[data-control-action]').forEach(function (button) { button.disabled = !can(button.dataset.controlAction); });
    var selected = library.getSelected();
    var playable = !!(selected && ['audio', 'video'].includes(selected.kind));
    $('detail-broadcast').hidden = !playable;
    $('detail-play-now').disabled = !playable || !selected.available || !can('play_now');
    $('detail-play-next').disabled = !playable || !selected.available || !can('play_next');
    $('detail-broadcast-note').textContent = commandError || (commandBusy || pendingPlayout ? 'Request sent. Waiting for player confirmation…' : !selected || !selected.available ? 'This file is not available on the station computer.' : !program().available ? 'Playback controls are unavailable for ' + outputName($('control-target').value) + '.' : !can('play_now') && !can('play_next') ? program().transitioning ? 'A transition is in progress. Please wait.' : 'Manual playback is not available on this station connection.' : 'Changes ' + outputName($('control-target').value) + ' · ' + (fadeSeconds() ? fadeSeconds() + '-second fade' : 'immediate cut') + '. Previews below play only on this device.');
  }

  function renderChannels() {
    channelIds.forEach(function (id) {
      var data = channel(id), section = document.querySelector('[data-channel="' + id + '"]');
      var slider = $('level-' + id), mute = $('mute-' + id), value = $('value-' + id);
      var available = isKnown() && data && data.available === true;
      var target = available && finiteDb(data.target_db) ? data.target_db : available && finiteDb(data.db) ? data.db : null;
      var muteKnown = available && typeof data.muted === 'boolean';
      var editable = can('mixer') && available;
      slider.disabled = !editable || target === null;
      mute.disabled = !editable || !muteKnown;
      if (target !== null && editingLevel !== id) { slider.value = String(Math.max(-60, Math.min(0, target))); value.textContent = decibels(target); }
      if (target === null) { value.textContent = '—'; slider.value = '-60'; }
      slider.style.setProperty('--fader-fill', ((Number(slider.value) + 60) / 60 * 100) + '%');
      slider.setAttribute('aria-valuetext', target === null ? 'Level unknown' : decibels(target) + ' decibels');
      mute.textContent = muteKnown && data.muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(!!(muteKnown && data.muted)));
      section.classList.toggle('channel-muted', !!(muteKnown && data.muted));
      section.classList.toggle('channel-unknown', !available);
      var state = section.querySelector('.channel-state');
      state.textContent = !available ? 'Unknown' : !muteKnown ? 'State unknown' : data.muted ? 'Muted' : 'Open';
      state.dataset.state = !muteKnown ? 'unknown' : data.muted ? 'muted' : 'open';
      var description = section.querySelector('.channel-description');
      description.textContent = id === 'mic' ? 'RE20 / prepared live level' : id === 'program_tall' ? 'Vertical canvas / program level' : 'Wide canvas / program level';
      var observed = available && finiteDb(data.observed_db) ? data.observed_db : available && finiteDb(data.db) ? data.db : null;
      if (observed !== null && target !== null && Math.abs(observed - target) > 0.1) description.textContent += ' · output ' + decibels(observed) + ' dB';
    });
  }

  function renderQueue() {
    var list = $('control-queue'), selected = program(), queued = selected.queued;
    list.replaceChildren();
    $('queue-count').textContent = queued.length ? queued.length + (queued.length === 1 ? ' queued file' : ' queued files') : 'Manual queue';
    if (!selected.available) { list.append(el('li', 'queue-empty', library.isConnected() ? 'Queue status unknown.' : 'Connect to see the queue.')); return; }
    if (!queued.length) { list.append(el('li', 'queue-empty', 'Nothing queued. Find something in the library.')); return; }
    queued.forEach(function (item, index) { var row = el('li', 'queue-item'); row.append(el('span', 'queue-number', String(index + 1).padStart(2, '0')), el('span', 'queue-name', labelFor(item)), el('span', 'queue-duration', duration(item && (item.duration || item.seconds)))); list.append(row); });
  }

  function render() {
    var selected = program(), known = selected.available, mode = selected.mode;
    $('control-mode').dataset.mode = mode;
    $('control-mode').textContent = commandBusy || pendingPlayout ? 'Awaiting confirmation' : selected.transitioning && known ? 'Transitioning' : mode === 'auto' ? 'Schedule running' : mode === 'override' ? 'Manual override' : mode === 'mixed' ? 'Mixed programs' : 'State unknown';
    $('program-label').textContent = outputName($('control-target').value) + ' · ' + (mode === 'override' ? 'manual selection' : mode === 'auto' ? 'scheduled program' : mode === 'mixed' ? 'observed program' : 'waiting for player');
    $('program-now').textContent = known && selected.now ? labelFor(selected.now) : mode === 'auto' ? 'Scheduled rotation' : mode === 'override' ? 'Manual playback' : library.isConnected() ? 'Program status unknown.' : 'Connect to your station.';
    var now = known && selected.now;
    $('program-detail').textContent = now ? [now.category, now.kind, duration(now.duration || now.seconds)].filter(Boolean).join(' · ') || 'Current selection reported by the player.' : mode === 'auto' ? 'This output is following its programmed rotation.' : mode === 'override' ? 'This output is reporting an active override.' : selected.error || 'Current program information appears after a successful player status check.';
    $('control-observed').textContent = known && observedAt ? 'Observed ' + new Date(observedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'No current observation';
    $('override-note').textContent = !library.isConnected() ? 'Sign in to check playback controls.' : !known ? 'Playback controls unavailable · selected output state unknown.' : pendingPlayout ? 'Request sent. Waiting for the selected player to confirm.' : selected.transitioning ? 'Transition in progress. Controls return when it finishes.' : !selected.capabilities.play_now ? 'Manual playback is not available on this output.' : selected.can_return ? 'Return to schedule ends the override and clears its queue.' : 'Scheduled playback continues until you take over.';
    var message = commandBusy ? 'Sending request… Controls are locked until the station responds.' : pendingPlayout ? 'Request sent to ' + outputName(pendingPlayout.target) + '. Waiting for player confirmation…' : commandError || (!isKnown() ? library.isConnected() ? 'Station state unknown. Checking the connection; controls are unavailable.' : 'Sign in to see the station’s observed state.' : selected.error || current.error || current.playout_error || (selected.transitioning ? 'The station is transitioning. Waiting for its next observation…' : lastCommand || 'Connected to the station. Playback controls affect ' + outputName($('control-target').value) + '; faders control the OBS mix.'));
    $('control-notice').textContent = message;
    $('control-notice').classList.toggle('is-error', !!commandError || !!(isKnown() && (current.error || selected.error)));
    renderChannels(); renderQueue(); renderActions();
  }

  function checkAcknowledgement() {
    if (!pendingPlayout) return;
    var reports = pendingPlayout.targets.map(function (name) { return current && current.renderers && current.renderers[name]; });
    var acks = reports.map(function (report) { return report && report.last_ack && report.last_ack.id === pendingPlayout.id ? report.last_ack : null; });
    var failure = acks.find(function (ack) { return ack && ack.ok === false; });
    if (failure) { commandError = 'Player rejected the request: ' + (failure.message || 'The requested change could not be completed.'); pendingPlayout = null; return; }
    if (acks.every(function (ack) { return ack && ack.ok === true; })) { lastCommand = outputName(pendingPlayout.target) + ' confirmed: ' + pendingPlayout.message; pendingPlayout = null; return; }
    if (Date.now() - pendingPlayout.started >= 15000) { commandError = 'Request outcome unknown. No player confirmation arrived within 15 seconds. No retry was sent. Check the next observed program before acting again.'; pendingPlayout = null; current = null; observedAt = 0; }
  }

  async function poll() {
    if (loading || commandBusy || !library.isConnected() || document.hidden) return;
    var version = epoch, generation = library.getGeneration();
    loading = true;
    try {
      var data = await library.request('/api/control', { signal: AbortSignal.timeout(5000) });
      if (version !== epoch || generation !== library.getGeneration()) return;
      if (!data || typeof data.available !== 'boolean') throw new Error('The station did not return a valid control status.');
      current = data; observedAt = data.available ? Date.now() : 0;
      if (!data.available) commandError = data.error || 'Station control is unavailable. State is unknown.';
      else if (commandError.startsWith('Station state unknown.') || commandError.startsWith('Station control is unavailable.')) commandError = '';
      checkAcknowledgement(); render();
    } catch (error) {
      if (version !== epoch || generation !== library.getGeneration()) return;
      current = null; observedAt = 0;
      if (!commandError) commandError = 'Station state unknown. The control connection did not respond. Checking again automatically.';
      checkAcknowledgement(); render();
    } finally { loading = false; }
  }

  function updateConnection() {
    epoch += 1; current = null; observedAt = 0; commandBusy = false; lastCommand = ''; commandError = ''; pendingPlayout = null;
    clearInterval(pollTimer); pollTimer = null;
    render();
    if (library.isConnected() && !document.hidden) { poll(); pollTimer = setInterval(poll, 3000); }
  }
  async function command(payload, successMessage) {
    var capability = payload.action === 'level' || payload.action === 'mute' ? 'mixer' : payload.action;
    if (!can(capability)) return;
    var version = ++epoch, generation = library.getGeneration();
    var isPlayout = ['play_now', 'play_next', 'return_to_schedule'].includes(payload.action);
    if (isPlayout) payload.target = $('control-target').value;
    commandBusy = true; commandError = ''; lastCommand = ''; render();
    try {
      // A mutation is sent once. A timed-out command may still have reached the station.
      var result = await library.request('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
      if (version !== epoch || generation !== library.getGeneration()) return;
      if (!result || result.ok !== true) throw new Error(result && result.error || 'The station did not confirm this command.');
      current = result.available !== undefined ? result : null;
      observedAt = current && current.available ? Date.now() : 0;
      if (isPlayout && result.accepted === true && typeof result.command_id === 'string') {
        pendingPlayout = { id: result.command_id, target: payload.target, targets: payload.target === 'all' ? ['wide', 'tall'] : [payload.target], started: Date.now(), message: successMessage };
        lastCommand = 'Request sent; waiting for player confirmation.'; checkAcknowledgement();
      } else if (isPlayout) { current = null; observedAt = 0; commandError = 'Request outcome unknown. The station did not provide a player confirmation reference. No retry was sent.'; }
      else lastCommand = successMessage + (current ? '' : ' Checking the station’s state…');
    } catch (error) {
      if (version !== epoch || generation !== library.getGeneration()) return;
      current = null; observedAt = 0;
      commandError = error.httpStatus ? 'Command not accepted: ' + error.message : 'Command outcome unknown. It may have reached the station. No retry was sent; wait for a fresh status before acting again.';
    } finally {
      if (version === epoch && generation === library.getGeneration()) { commandBusy = false; render(); }
    }
  }
  function play(action, item) {
    if (!item || !item.available || !['audio', 'video'].includes(item.kind) || !['play_now', 'play_next'].includes(action)) return;
    command({ action: action, item_id: item.id, fade_seconds: fadeSeconds() }, action === 'play_now' ? 'Play now — ' + item.title + '.' : 'Play next — ' + item.title + '.');
  }

  channelIds.forEach(function (id) {
    var slider = $('level-' + id);
    slider.addEventListener('input', function () { editingLevel = id; $('value-' + id).textContent = decibels(Number(slider.value)); slider.style.setProperty('--fader-fill', ((Number(slider.value) + 60) / 60 * 100) + '%'); slider.setAttribute('aria-valuetext', decibels(Number(slider.value)) + ' decibels'); });
    slider.addEventListener('change', function () { editingLevel = null; var data = channel(id); if (data && data.available) command({ action: 'level', channel: id, value: Number(slider.value), fade_seconds: fadeSeconds() }, 'Level change accepted.'); });
    slider.addEventListener('blur', function () { if (editingLevel === id) { editingLevel = null; renderChannels(); } });
    $('mute-' + id).addEventListener('click', function () { var data = channel(id); if (data && data.available && typeof data.muted === 'boolean') command({ action: 'mute', channel: id, value: !data.muted }, data.muted ? 'Unmute accepted.' : 'Mute accepted.'); });
  });
  $('choose-track').addEventListener('click', function () { library.selectTab('library'); $('search').focus(); });
  $('spotify-library').addEventListener('click', function () { library.selectTab('library'); });
  $('return-schedule').addEventListener('click', function () { command({ action: 'return_to_schedule', fade_seconds: fadeSeconds() }, 'Return to schedule.'); });
  $('fade-duration').addEventListener('change', renderActions);
  $('control-target').addEventListener('change', function () { lastCommand = ''; commandError = ''; render(); });
  $('detail-play-now').addEventListener('click', function () { play('play_now', library.getSelected()); });
  $('detail-play-next').addEventListener('click', function () { play('play_next', library.getSelected()); });
  document.addEventListener('sfv-library-selection', renderActions);
  document.addEventListener('sfv-library-connection', updateConnection);
  document.addEventListener('visibilitychange', function () { clearInterval(pollTimer); pollTimer = null; if (!document.hidden && library.isConnected()) { current = null; observedAt = 0; render(); poll(); pollTimer = setInterval(poll, 3000); } });

  function spotifyReference(value) {
    var match = value.trim().match(/^spotify:(track|album|artist|playlist):([A-Za-z0-9]+)$/);
    if (match) return { type: match[1], id: match[2] };
    try {
      var url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return null;
      match = url.pathname.match(/^\/(track|album|artist|playlist)\/([A-Za-z0-9]+)\/?$/);
      return match ? { type: match[1], id: match[2] } : null;
    } catch (error) { return null; }
  }
  function clearSpotify() {
    var empty = el('div', 'spotify-empty'); empty.append(el('span', '', '♫'), el('h3', '', 'Your listening corner.'), el('p', '', 'Add a Spotify link to load the player. Playback starts when you press play.'));
    $('spotify-player').replaceChildren(empty); $('spotify-clear').hidden = true;
    $('spotify-open').href = 'https://open.spotify.com/'; $('spotify-open').textContent = 'Browse in Spotify ↗';
    $('spotify-message').textContent = 'Player closed. Nothing is playing here.';
  }
  $('spotify-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var reference = spotifyReference($('spotify-url').value);
    if (!reference) { $('spotify-message').textContent = 'Use an https://open.spotify.com track, album, artist or playlist link, or its spotify: URI.'; $('spotify-url').setAttribute('aria-invalid', 'true'); return; }
    $('spotify-url').removeAttribute('aria-invalid');
    var canonical = 'https://open.spotify.com/' + reference.type + '/' + reference.id;
    var frame = el('iframe'); frame.title = 'Spotify ' + reference.type + ' preview on this device'; frame.src = 'https://open.spotify.com/embed/' + reference.type + '/' + reference.id + '?theme=0'; frame.allow = 'encrypted-media; fullscreen; picture-in-picture'; frame.loading = 'lazy'; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.setAttribute('allowfullscreen', '');
    $('spotify-player').replaceChildren(frame); $('spotify-clear').hidden = false;
    $('spotify-open').href = canonical; $('spotify-open').textContent = 'Open this ' + reference.type + ' in Spotify ↗';
    $('spotify-message').textContent = 'Preview loaded. Press play in Spotify to listen on this device.';
  });
  $('spotify-clear').addEventListener('click', clearSpotify);
  $('load-radio').addEventListener('click', function () {
    var frame = el('iframe'); frame.title = 'SFV.FM radio booth — separate radio output'; frame.src = 'https://sfv.fm/booth.html'; frame.allow = 'microphone https://sfv.fm; display-capture https://sfv.fm'; frame.referrerPolicy = 'no-referrer';
    $('radio-player').replaceChildren(frame); $('load-radio').hidden = true; $('close-radio').hidden = false;
  });
  $('close-radio').addEventListener('click', function () { $('radio-player').replaceChildren(el('p', 'radio-closed', 'Radio controls closed. Open the radio separately to check its broadcast state.')); $('load-radio').hidden = false; $('close-radio').hidden = true; });
  window.sfvControl = { can: can, play: play };
  updateConnection();
}());

// Front end: month calendar + day agenda (from GET /api/appointments) and the assistant chat
// (POST /api/chat, POST /api/chat/reply). Plain JS, no build step. All server text is inserted
// with textContent, never innerHTML.
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    title: $('month-title'), grid: $('grid'), events: $('events'),
    agendaTitle: $('agenda-title'), agendaCount: $('agenda-count'), agendaDot: $('agenda-dot'),
    thread: $('thread'), form: $('composer'), input: $('chat-input'), send: $('send'),
    pending: $('pending'), skip: $('skip-question'), chat: $('chat'), toggle: $('chat-toggle'),
  };

  var now = new Date();
  var todayKey = key(now.getFullYear(), now.getMonth(), now.getDate());
  var view = { year: now.getFullYear(), month: now.getMonth() };
  var selected = todayKey;
  var byDate = {};          // 'YYYY-MM-DD' -> appointments sorted by start time
  var loadError = false;
  var pendingState = null;  // opaque state returned with an ASK; sent back with the reply
  var busy = false;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function key(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // "13:00:00" -> "1:00 PM"; adds minutes to get the end time
  function clock(mins) {
    var h = Math.floor(mins / 60) % 24, m = mins % 60;
    return (h % 12 || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function startMins(a) { var p = String(a.start_time).split(':'); return +p[0] * 60 + +p[1]; }
  function timeRange(a) {
    var s = startMins(a), dur = a.duration_minutes || 60;
    return clock(s) + ' – ' + clock(s + dur);
  }

  // ---------- Calendar ----------
  function loadAppointments() {
    return fetch('/api/appointments')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (rows) {
        byDate = {};
        rows.forEach(function (a) { (byDate[a.date] = byDate[a.date] || []).push(a); });
        Object.keys(byDate).forEach(function (k) { byDate[k].sort(function (a, b) { return startMins(a) - startMins(b); }); });
        loadError = false;
      })
      .catch(function () { loadError = true; })
      .then(render);
  }

  function renderGrid() {
    els.title.textContent = MONTHS[view.month] + ' ' + view.year;
    els.grid.textContent = '';
    var first = new Date(view.year, view.month, 1);
    var offset = (first.getDay() + 6) % 7;                 // Monday first
    var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    var rows = Math.ceil((offset + daysInMonth) / 7);
    for (var i = 0; i < rows * 7; i++) {
      var d = new Date(view.year, view.month, 1 - offset + i);
      var k = key(d.getFullYear(), d.getMonth(), d.getDate());
      var inMonth = d.getMonth() === view.month;
      var list = byDate[k] || [];
      var btn = el('button', 'day');
      btn.type = 'button';
      btn.setAttribute('role', 'gridcell');
      btn.dataset.date = k;
      if (!inMonth) btn.classList.add('other');
      if (i % 7 > 4) btn.classList.add('weekend');
      if (k === todayKey) btn.classList.add('today');
      if (k === selected) btn.classList.add('selected');
      btn.setAttribute('aria-label', DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
        (list.length ? ', ' + list.length + (list.length === 1 ? ' event' : ' events') : ''));
      if (k === selected) btn.setAttribute('aria-current', 'date');
      btn.appendChild(el('span', 'num', '' + d.getDate()));
      var dots = el('span', 'dots');
      list.slice(0, 3).forEach(function (a) { dots.appendChild(el('i', a.source === 'simulation' ? 'sim' : '')); });
      if (list.length > 3) dots.appendChild(el('small', '', '+' + (list.length - 3)));
      btn.appendChild(dots);
      els.grid.appendChild(btn);
    }
  }

  function renderAgenda() {
    var d = parseKey(selected);
    els.agendaTitle.textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() +
      (selected === todayKey ? ' (Today)' : '');
    els.agendaDot.className = 'dot' + (selected === todayKey ? ' today' : '');
    var list = byDate[selected] || [];
    els.agendaCount.textContent = loadError ? '' : list.length + (list.length === 1 ? ' event' : ' events') + ' scheduled';
    els.events.textContent = '';
    if (loadError) { els.events.appendChild(el('div', 'empty', 'Could not load appointments.')); return; }
    if (!list.length) { els.events.appendChild(el('div', 'empty', 'Nothing scheduled.')); return; }
    list.forEach(function (a) {
      var card = el('div', 'event' + (a.source === 'simulation' ? ' sim' : ''));
      card.appendChild(el('div', 'bar'));
      var body = el('div', 'body');
      var text = el('div');
      text.appendChild(el('div', 'title', a.title));
      var bits = [];
      if (a.person) bits.push(a.person);
      bits.push((a.duration_minutes || 60) + ' min');
      text.appendChild(el('div', 'sub', bits.join(' • ')));
      body.appendChild(text);
      body.appendChild(el('span', 'time', timeRange(a)));
      card.appendChild(body);
      els.events.appendChild(card);
    });
  }

  function render() { renderGrid(); renderAgenda(); }

  function go(delta) {
    var d = new Date(view.year, view.month + delta, 1);
    view.year = d.getFullYear(); view.month = d.getMonth();
    renderGrid();
  }

  els.grid.addEventListener('click', function (e) {
    var b = e.target.closest('.day');
    if (!b) return;
    selected = b.dataset.date;
    var d = parseKey(selected);
    view.year = d.getFullYear(); view.month = d.getMonth();
    render();
  });
  $('prev-month').addEventListener('click', function () { go(-1); });
  $('next-month').addEventListener('click', function () { go(1); });
  $('today-btn').addEventListener('click', function () {
    selected = todayKey; view.year = now.getFullYear(); view.month = now.getMonth(); render();
  });

  // ---------- Chat ----------
  function stamp() { var d = new Date(); return clock(d.getHours() * 60 + d.getMinutes()); }

  function addMessage(role, text, opts) {
    opts = opts || {};
    var m = el('div', 'msg ' + role + (opts.kind ? ' ' + opts.kind : ''));
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'who', role === 'user' ? 'You' : 'Assistant'));
    meta.appendChild(el('span', 'stamp', stamp()));
    m.appendChild(meta);
    var bubble = el('div', 'bubble');
    if (opts.kind === 'done') bubble.innerHTML = CHECK;   // static icon markup only
    bubble.appendChild(opts.kind === 'done' ? el('span', '', text) : document.createTextNode(text));
    m.appendChild(bubble);
    if (opts.badge) m.appendChild(el('span', 'badge ' + (opts.kind || ''), opts.badge));
    if (opts.why) m.appendChild(el('div', 'why', opts.why));
    els.thread.appendChild(m);
    els.thread.scrollTop = els.thread.scrollHeight;
    return m;
  }

  // One line explaining the decision, from the server's `trace` (policy, what fired, score vs threshold).
  function whyLine(t) {
    if (!t) return '';
    var parts = ['policy ' + t.policy];
    if (t.fired && t.fired.length) parts.push('signals: ' + t.fired.join(', '));
    if (typeof t.score === 'number' && typeof t.theta === 'number') {
      parts.push('score ' + (Math.round(t.score * 100) / 100) + ' vs threshold ' + t.theta);
    }
    return parts.join(' · ');
  }

  function setPending(state) {
    pendingState = state || null;
    els.pending.classList.toggle('hidden', !pendingState);
    els.input.placeholder = pendingState ? 'Type your answer…' : 'Book, move or cancel an appointment…';
  }

  function setBusy(v) { busy = v; els.send.disabled = v; els.input.disabled = v; if (!v) els.input.focus(); }

  function handleResult(r) {
    var why = whyLine(r.trace);
    switch (r.status) {
      case 'ask':
        setPending(r.state);
        addMessage('assistant', r.question, { kind: 'ask', badge: 'Needs your answer', why: why });
        break;
      case 'done':
        setPending(null);
        addMessage('assistant', r.message, { kind: 'done', why: why });
        return loadAppointments().then(focusChange.bind(null, r.action));
      default: // not_found, gave_up, parse_error
        setPending(null);
        addMessage('assistant', r.message || 'Something went wrong.', { why: why });
    }
  }

  // After a change, jump to the day it landed on so the user sees the result.
  function focusChange(action) {
    var k = null;
    if (action.type === 'create') k = action.appointment.date;
    else if (action.type === 'reschedule' && action.changes.date) k = action.changes.date;
    if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    selected = k;
    var d = parseKey(k);
    view.year = d.getFullYear(); view.month = d.getMonth();
    render();
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = els.input.value.trim();
    if (!text || busy) return;
    els.input.value = '';
    addMessage('user', text);
    var typing = addMessage('assistant', '', { kind: 'typing' });
    var isReply = !!pendingState;
    var url = isReply ? '/api/chat/reply' : '/api/chat';
    var body = isReply ? { text: text, state: pendingState } : { text: text };
    setBusy(true);
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, json: j }; });
      })
      .then(function (res) {
        typing.remove();
        if (!res.ok) {
          // A bad/expired state means the question can no longer be answered: start fresh.
          if (isReply) setPending(null);
          addMessage('assistant', (res.json && res.json.error) || 'The assistant is not available right now.', { kind: 'error' });
          return;
        }
        return handleResult(res.json);
      })
      .catch(function () {
        typing.remove();
        addMessage('assistant', 'Could not reach the server. Check your connection and try again.', { kind: 'error' });
      })
      .then(function () { setBusy(false); });
  });

  els.skip.addEventListener('click', function () { setPending(null); els.input.focus(); });

  els.toggle.addEventListener('click', function () {
    var collapsed = els.chat.classList.toggle('collapsed');
    els.toggle.setAttribute('aria-expanded', String(!collapsed));
    els.toggle.setAttribute('aria-label', collapsed ? 'Expand assistant' : 'Collapse assistant');
  });

  render();
  loadAppointments();
})();

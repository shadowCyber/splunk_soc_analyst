/* Cyber Defense Runbooks
 * Source of truth: appserver/static/runbooks_data.json  (git-managed)
 * Writes (new/edit): KV store via native fetch() + CSRF
 * Import .md       : loads into current session in-memory
 *
 * To update from your runbooks repo:
 *   python3 scripts/sync_runbooks.py --src /path/to/runbooks-repo --deploy
 */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────── */
  var STATIC_JSON = '/static/app/soc_triage_app/runbooks_data.json';
  var KV_URL      = '/en-US/splunkd/__raw/servicesNS/nobody/soc_triage_app/storage/collections/data/soc_runbooks';

  /* ── State ───────────────────────────────────────────────────── */
  var all = [];   // merged: static (git) + kv (local)
  var cur = null;

  var SEV_ICON = {
    critical: '\uD83D\uDD34',
    high:     '\uD83D\uDFE0',
    medium:   '\uD83D\uDFE1',
    low:      '\uD83D\uDFE2',
    all:      '\u26AA'
  };

  /* ── CSRF ────────────────────────────────────────────────────── */
  function getCsrf() {
    if (window.$C && window.$C['XSRF_FORM_KEY']) return window.$C['XSRF_FORM_KEY'];
    var m = document.cookie.match(/splunkweb_csrf_token_\d+=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ── KV write helpers (native fetch — no jQuery / SDK) ───────── */
  function kvPost(url, body, cb) {
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Splunk-Form-Key': getCsrf(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(body)
    })
    .then(function (r) {
      if (!r.ok) {
        r.text().then(function (t) { cb(new Error(r.status + ': ' + t.slice(0, 200))); });
        return;
      }
      cb(null);
    })
    .catch(cb);
  }

  function kvDeleteReq(key, cb) {
    fetch(KV_URL + '/' + encodeURIComponent(key), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-Splunk-Form-Key': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(function (r) { cb(r.ok ? null : new Error('DELETE ' + r.status)); })
    .catch(cb);
  }

  /* ── Load ────────────────────────────────────────────────────── */
  function load() {
    setStatus('Loading...');

    // Step 1: fetch static JSON (git runbooks — no auth, always works)
    fetch(STATIC_JSON + '?_=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('runbooks_data.json returned HTTP ' + r.status);
        return r.json();
      })
      .then(function (staticRbs) {
        if (!Array.isArray(staticRbs)) staticRbs = [];

        // Step 2: attempt KV store for locally-created runbooks (best effort)
        fetch(KV_URL + '?output_mode=json&count=0&_=' + Date.now(), {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (kvRbs) {
          if (!Array.isArray(kvRbs)) kvRbs = [];

          // Merge: static first; KV fills in anything not already in static
          var staticKeys = {};
          staticRbs.forEach(function (r) { staticKeys[r._key] = true; });
          var localOnly = kvRbs.filter(function (r) {
            return !staticKeys[r._key] && r.active !== 'false';
          });

          all = staticRbs
            .filter(function (r) { return r.active !== 'false'; })
            .concat(localOnly);

          renderList();
          if (cur) {
            var found = all.filter(function (r) { return r._key === cur; })[0];
            if (found) renderViewer(found);
          }
        });
      })
      .catch(function (err) {
        showError(
          'Could not load runbooks_data.json: ' + err.message + '\n\n' +
          'Run: python3 scripts/sync_runbooks.py --src /path/to/runbooks-repo --deploy'
        );
      });
  }

  /* ── Utilities ───────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function catClass(c) { return 'rb-cat-' + (c || 'general'); }

  function setStatus(msg) {
    var el = document.getElementById('rb-list-items');
    if (el) el.innerHTML = '<div class="rb-list-empty">' + esc(msg) + '</div>';
    var cnt = document.getElementById('rb-list-count');
    if (cnt) cnt.textContent = '...';
  }

  function showError(msg) {
    var el = document.getElementById('rb-list-items');
    if (el) el.innerHTML =
      '<div class="rb-list-empty" style="color:#ff6b6b;font-size:12px;line-height:1.6;white-space:pre-wrap;">' +
      '<b>Error:</b>\n' + esc(msg) + '</div>';
    var cnt = document.getElementById('rb-list-count');
    if (cnt) cnt.textContent = '!';
  }

  /* ── Render list ─────────────────────────────────────────────── */
  function renderList() {
    var items = document.getElementById('rb-list-items');
    if (!items) return;
    var cnt = document.getElementById('rb-list-count');
    if (!all.length) {
      items.innerHTML = '<div class="rb-list-empty">No runbooks. Click + New Runbook or run sync_runbooks.py.</div>';
      if (cnt) cnt.textContent = '0';
      return;
    }
    if (cnt) cnt.textContent = all.length;
    items.innerHTML = all.map(function (r) {
      var active   = r._key === cur ? ' active' : '';
      var sic      = SEV_ICON[r.severity_scope] || SEV_ICON.all;
      var gitBadge = r.source === 'git'
        ? '<span style="color:#4dabf7;font-size:9px;margin-left:4px;vertical-align:middle;">GIT</span>' : '';
      return '<div class="rb-item' + active + '" onclick="window.rbSelect(\'' +
        encodeURIComponent(r._key || '') + '\')">' +
        '<div class="rb-title-text">' + esc(r.title || 'Untitled') + gitBadge + '</div>' +
        '<div class="rb-meta-row">' +
          '<span class="rb-badge ' + catClass(r.category) + '">' + esc(r.category || 'general') + '</span>' +
          '<span class="rb-sev-' + (r.severity_scope || 'all') + '">' +
            sic + ' ' + (r.severity_scope || 'all') + '</span>' +
          (r.author ? '<span style="color:#5c6370;">' + esc(r.author) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ── Render viewer ───────────────────────────────────────────── */
  function renderViewer(r) {
    var emptyEl  = document.getElementById('rb-empty');
    var detailEl = document.getElementById('rb-detail');
    if (!detailEl) return;
    emptyEl.style.display  = 'none';
    detailEl.style.display = 'flex';

    document.getElementById('rb-d-title').textContent = r.title || 'Untitled';

    var gitNote = r.source === 'git'
      ? '<span style="color:#4dabf7;font-size:10px;background:#0d2137;padding:2px 6px;border-radius:4px;margin-left:6px;">git-managed</span>'
      : '';

    var meta = [
      r.category       ? '<span class="rb-badge ' + catClass(r.category) + '">' + esc(r.category) + '</span>' : '',
      r.severity_scope ? '<span class="rb-sev-' + (r.severity_scope||'all') + '">' +
                          (SEV_ICON[r.severity_scope]||SEV_ICON.all) + ' ' + esc(r.severity_scope) + '</span>' : '',
      r.author         ? '<span>&#x1F464; ' + esc(r.author)  + '</span>' : '',
      r.version        ? '<span>v'          + esc(r.version) + '</span>' : '',
      r.last_updated   ? '<span>&#x1F4C5; ' + esc((r.last_updated||'').substr(0, 10)) + '</span>' : '',
      r.tags           ? '<span style="color:#5c6370;">&#x1F3F7; ' + esc(r.tags) + '</span>' : '',
      gitNote
    ].filter(Boolean).join('');
    document.getElementById('rb-d-meta').innerHTML = meta;

    var md     = r.content_md || '*No content.*';
    var render = document.getElementById('rb-md-render');
    if (window.marked) {
      render.innerHTML = window.marked.parse(md, { gfm: true, breaks: true });
    } else {
      render.innerHTML = '<pre style="white-space:pre-wrap;color:#c7d0dd;">' + esc(md) + '</pre>';
    }

    try {
      var blob = new Blob([md], { type: 'text/markdown' });
      var dl   = document.getElementById('rb-dl-link');
      dl.href     = URL.createObjectURL(blob);
      dl.download = (r.title || 'runbook').replace(/[^\w\-]/g, '_') + '.md';
    } catch(e) {}
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.rbSelect = function (enc) {
    cur = decodeURIComponent(enc);
    var r = all.filter(function (x) { return x._key === cur; })[0];
    if (r) { renderViewer(r); renderList(); }
  };

  window.rbNew = function () {
    document.getElementById('rb-f-key').value     = '';
    document.getElementById('rb-f-title').value   = '';
    document.getElementById('rb-f-cat').value     = 'general';
    document.getElementById('rb-f-sev').value     = 'all';
    document.getElementById('rb-f-ver').value     = '1.0';
    document.getElementById('rb-f-author').value  = '';
    document.getElementById('rb-f-tags').value    = '';
    document.getElementById('rb-f-content').value =
      '# Runbook Title\n\n## Overview\nDescribe what this runbook covers.\n\n' +
      '## Steps\n\n### Step 1\n- [ ] Action one\n\n### Step 2\n- [ ] Action two\n\n' +
      '## Escalation\nEscalate if...\n\n## References\n- MITRE: https://attack.mitre.org/\n';
    document.getElementById('rb-modal-title').textContent = 'New Runbook';
    document.getElementById('rb-save-msg').textContent    = '';
    document.getElementById('rb-modal-bg').classList.add('open');
    setTimeout(function () { document.getElementById('rb-f-title').focus(); }, 100);
  };

  window.rbEdit = function () {
    if (!cur) return;
    var r = all.filter(function (x) { return x._key === cur; })[0];
    if (!r) return;
    document.getElementById('rb-f-key').value     = r._key;
    document.getElementById('rb-f-title').value   = r.title    || '';
    document.getElementById('rb-f-cat').value     = r.category || 'general';
    document.getElementById('rb-f-sev').value     = r.severity_scope || 'all';
    document.getElementById('rb-f-ver').value     = r.version  || '1.0';
    document.getElementById('rb-f-author').value  = r.author   || '';
    document.getElementById('rb-f-tags').value    = r.tags     || '';
    document.getElementById('rb-f-content').value = r.content_md || '';
    document.getElementById('rb-modal-title').textContent = 'Edit Runbook';
    document.getElementById('rb-save-msg').textContent    = r.source === 'git'
      ? 'Note: git-managed \u2014 edit in your runbooks repo for permanent changes.'
      : '';
    document.getElementById('rb-modal-bg').classList.add('open');
  };

  window.rbSave = function () {
    var key   = document.getElementById('rb-f-key').value;
    var title = document.getElementById('rb-f-title').value.trim();
    if (!title) { alert('Title is required.'); return; }
    var isNew = !key;
    if (!key) key = title.toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now();
    var payload = {
      _key:           key,
      title:          title,
      category:       document.getElementById('rb-f-cat').value,
      severity_scope: document.getElementById('rb-f-sev').value,
      version:        document.getElementById('rb-f-ver').value || '1.0',
      author:         document.getElementById('rb-f-author').value,
      tags:           document.getElementById('rb-f-tags').value,
      content_md:     document.getElementById('rb-f-content').value,
      active:         'true',
      last_updated:   new Date().toISOString().replace(/\.\d{3}Z/, 'Z'),
      source:         'local'
    };
    var msg = document.getElementById('rb-save-msg');
    msg.style.color = '#8892a4'; msg.textContent = 'Saving...';
    // POST to create (new) or POST to update (existing _key)
    var url = isNew ? KV_URL : (KV_URL + '/' + encodeURIComponent(key));
    kvPost(url, payload, function (err) {
      if (err) {
        // Fall back: keep in-memory for current session
        msg.style.color = '#f0b429';
        msg.textContent = 'KV save failed (' + err.message + '). Showing in session only.';
        var idx = all.findIndex ? all.findIndex(function (r) { return r._key === key; }) : -1;
        if (idx >= 0) { all[idx] = payload; } else { all.push(payload); }
        cur = key; renderList();
        setTimeout(function () { window.rbCloseModal(); renderViewer(payload); }, 1500);
      } else {
        cur = key;
        msg.style.color = '#8ce99a'; msg.textContent = 'Saved!';
        setTimeout(function () { window.rbCloseModal(); load(); }, 500);
      }
    });
  };

  window.rbDelete = function () {
    if (!cur) return;
    var r = all.filter(function (x) { return x._key === cur; })[0];
    if (!r) return;
    if (r.source === 'git') {
      alert('This runbook is git-managed.\nTo remove it, delete the .md file from your runbooks repo and re-run sync_runbooks.py.');
      return;
    }
    if (!confirm('Delete "' + (r.title || 'this runbook') + '"?\nThis cannot be undone.')) return;
    kvDeleteReq(cur, function (err) {
      if (err) console.warn('KV delete:', err.message);
      all = all.filter(function (x) { return x._key !== cur; });
      cur = null;
      document.getElementById('rb-empty').style.display  = 'flex';
      document.getElementById('rb-detail').style.display = 'none';
      renderList();
    });
  };

  window.rbImport = function () { document.getElementById('rb-file-input').click(); };

  window.rbCloseModal = function () { document.getElementById('rb-modal-bg').classList.remove('open'); };

  window.rbHandleFile = function (evt) {
    var file = evt.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var rawName = file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]/g, ' ');
      document.getElementById('rb-f-key').value     = '';
      document.getElementById('rb-f-title').value   = rawName;
      document.getElementById('rb-f-cat').value     = 'general';
      document.getElementById('rb-f-sev').value     = 'all';
      document.getElementById('rb-f-ver').value     = '1.0';
      document.getElementById('rb-f-author').value  = '';
      document.getElementById('rb-f-tags').value    = '';
      document.getElementById('rb-f-content').value = e.target.result;
      document.getElementById('rb-modal-title').textContent = 'Import: ' + rawName;
      document.getElementById('rb-save-msg').textContent    =
        'Fill in metadata above, then Save to store locally.';
      document.getElementById('rb-modal-bg').classList.add('open');
    };
    reader.readAsText(file);
    evt.target.value = '';
  };

  /* ── Boot ────────────────────────────────────────────────────── */
  load();
  setInterval(load, 120000);

}());

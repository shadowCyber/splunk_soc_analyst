/* SOC Runbooks – KV store frontend
 * Loaded via <script src="/static/app/soc_triage_app/runbooks.js">
 * Runs after DOM is ready (deferred by the onload wrapper below).
 */
(function waitForJQuery() {
  if (typeof window.jQuery === 'undefined') {
    return setTimeout(waitForJQuery, 50);
  }
  var $ = window.jQuery;

  /* ── Config ─────────────────────────────────────────────── */
  var BASE = '/en-US/splunkd/__raw/servicesNS/nobody/soc_triage_app/storage/collections/data/soc_runbooks';

  /* ── State ───────────────────────────────────────────────── */
  var all = [];
  var cur = null;

  var SEV_ICON = {
    critical: '\uD83D\uDD34',
    high:     '\uD83D\uDFE0',
    medium:   '\uD83D\uDFE1',
    low:      '\uD83D\uDFE2',
    all:      '\u26AA'
  };

  /* ── CSRF token ──────────────────────────────────────────── */
  function csrfToken() {
    // Try window.$C first (Splunk injects this on every page)
    if (window.$C && window.$C['XSRF_FORM_KEY']) {
      return window.$C['XSRF_FORM_KEY'];
    }
    // Fall back to cookie (splunkweb_csrf_token_PORT=VALUE)
    var m = document.cookie.match(/splunkweb_csrf_token_\d+=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ── KV helpers ──────────────────────────────────────────── */
  function kvGet(cb) {
    $.ajax({
      url:         BASE + '?output_mode=json&count=0',
      type:        'GET',
      headers:     { 'X-Splunk-Form-Key': csrfToken() },
      xhrFields:   { withCredentials: true },
      success:     function(d) { cb(null, Array.isArray(d) ? d : []); },
      error:       function(x) { cb(new Error(x.status + ' ' + x.responseText), []); }
    });
  }

  function kvSave(payload, key, cb) {
    var url = BASE + (key ? '/' + encodeURIComponent(key) : '') + '?output_mode=json';
    $.ajax({
      url:         url,
      type:        'POST',
      contentType: 'application/json',
      data:        JSON.stringify(payload),
      headers:     { 'X-Splunk-Form-Key': csrfToken() },
      xhrFields:   { withCredentials: true },
      success:     function(d) { cb(null, d); },
      error:       function(x) { cb(new Error(x.status + ' ' + x.responseText)); }
    });
  }

  function kvDel(key, cb) {
    $.ajax({
      url:       BASE + '/' + encodeURIComponent(key) + '?output_mode=json',
      type:      'DELETE',
      headers:   { 'X-Splunk-Form-Key': csrfToken() },
      xhrFields: { withCredentials: true },
      success:   function()  { cb(null); },
      error:     function(x) { cb(new Error(x.status + ' ' + x.responseText)); }
    });
  }

  /* ── Utilities ───────────────────────────────────────────── */
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function catClass(c) { return 'rb-cat-' + (c || 'general'); }

  /* ── Render list ─────────────────────────────────────────── */
  function renderList() {
    var items = document.getElementById('rb-list-items');
    if (!items) return;
    if (!all.length) {
      items.innerHTML = '<div class="rb-list-empty">No runbooks yet. Click + New Runbook.</div>';
      document.getElementById('rb-list-count').textContent = '0';
      return;
    }
    document.getElementById('rb-list-count').textContent = all.length;
    items.innerHTML = all.map(function(r) {
      var active = r._key === cur ? ' active' : '';
      var sic    = SEV_ICON[r.severity_scope] || SEV_ICON.all;
      return '<div class="rb-item' + active + '" onclick="window.rbSelect(\'' + encodeURIComponent(r._key || '') + '\')">' +
               '<div class="rb-title-text">' + esc(r.title || 'Untitled') + '</div>' +
               '<div class="rb-meta-row">' +
                 '<span class="rb-badge ' + catClass(r.category) + '">' + esc(r.category || 'general') + '</span>' +
                 '<span class="rb-sev-' + (r.severity_scope || 'all') + '">' + sic + ' ' + (r.severity_scope || 'all') + '</span>' +
                 (r.author ? '<span style="color:#5c6370;">' + esc(r.author) + '</span>' : '') +
               '</div>' +
             '</div>';
    }).join('');
  }

  /* ── Render viewer ───────────────────────────────────────── */
  function renderViewer(r) {
    var emptyEl  = document.getElementById('rb-empty');
    var detailEl = document.getElementById('rb-detail');
    if (!detailEl) return;
    emptyEl.style.display  = 'none';
    detailEl.style.display = 'flex';

    document.getElementById('rb-d-title').textContent = r.title || 'Untitled';

    var meta = [
      r.category      ? '<span class="rb-badge ' + catClass(r.category) + '">' + esc(r.category) + '</span>' : '',
      r.severity_scope? '<span class="rb-sev-'+(r.severity_scope||'all')+'">'+(SEV_ICON[r.severity_scope]||SEV_ICON.all)+' '+esc(r.severity_scope)+'</span>' : '',
      r.author        ? '<span>&#x1F464; ' + esc(r.author)  + '</span>' : '',
      r.version       ? '<span>v'           + esc(r.version) + '</span>' : '',
      r.last_updated  ? '<span>&#x1F4C5; ' + esc((r.last_updated||'').substr(0,10)) + '</span>' : '',
      r.tags          ? '<span style="color:#5c6370;">&#x1F3F7; ' + esc(r.tags) + '</span>' : ''
    ].filter(Boolean).join('');
    document.getElementById('rb-d-meta').innerHTML = meta;

    var md     = r.content_md || '*No content. Click Edit to add markdown.*';
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

  /* ── Load all ────────────────────────────────────────────── */
  function load() {
    var items = document.getElementById('rb-list-items');
    if (items) items.innerHTML = '<div class="rb-list-empty">Loading...</div>';
    kvGet(function(err, data) {
      if (err || !Array.isArray(data)) {
        var msg = err ? err.message : 'bad response';
        if (items) items.innerHTML = '<div class="rb-list-empty" style="color:#ff6b6b;">Error: ' + esc(msg) + '</div>';
        var cnt = document.getElementById('rb-list-count');
        if (cnt) cnt.textContent = '!';
        return;
      }
      all = data.filter(function(r) { return r.active !== 'false'; });
      renderList();
      if (cur) {
        var found = all.filter(function(r) { return r._key === cur; })[0];
        if (found) renderViewer(found);
      }
    });
  }

  /* ── Public window functions ─────────────────────────────── */
  window.rbSelect = function(enc) {
    cur = decodeURIComponent(enc);
    var r = all.filter(function(x) { return x._key === cur; })[0];
    if (r) { renderViewer(r); renderList(); }
  };

  window.rbNew = function() {
    document.getElementById('rb-f-key').value     = '';
    document.getElementById('rb-f-title').value   = '';
    document.getElementById('rb-f-cat').value     = 'general';
    document.getElementById('rb-f-sev').value     = 'all';
    document.getElementById('rb-f-ver').value     = '1.0';
    document.getElementById('rb-f-author').value  = '';
    document.getElementById('rb-f-tags').value    = '';
    document.getElementById('rb-f-content').value =
      '# Runbook Title\n\n## Overview\nDescribe what this runbook covers.\n\n' +
      '## When to Use\n- Triggered by...\n\n## Steps\n\n### Step 1\n- [ ] Action one\n\n' +
      '### Step 2\n- [ ] Action two\n\n## Escalation\nEscalate if...\n\n## References\n- MITRE: https://attack.mitre.org/\n';
    document.getElementById('rb-modal-title').textContent = 'New Runbook';
    document.getElementById('rb-save-msg').textContent    = '';
    document.getElementById('rb-modal-bg').classList.add('open');
    setTimeout(function() { document.getElementById('rb-f-title').focus(); }, 100);
  };

  window.rbEdit = function() {
    if (!cur) return;
    var r = all.filter(function(x) { return x._key === cur; })[0];
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
    document.getElementById('rb-save-msg').textContent    = '';
    document.getElementById('rb-modal-bg').classList.add('open');
  };

  window.rbSave = function() {
    var key   = document.getElementById('rb-f-key').value;
    var title = document.getElementById('rb-f-title').value.trim();
    if (!title) { alert('Title is required.'); return; }
    var genKey = !key;
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
      last_updated:   new Date().toISOString().replace(/\.\d{3}Z/, 'Z')
    };
    var msg = document.getElementById('rb-save-msg');
    msg.style.color  = '#8892a4';
    msg.textContent  = 'Saving...';
    kvSave(payload, genKey ? null : key, function(err) {
      if (err) {
        msg.style.color = '#ff6b6b';
        msg.textContent = 'Error: ' + err.message;
      } else {
        cur = key;
        msg.style.color = '#8ce99a';
        msg.textContent = 'Saved!';
        setTimeout(function() { window.rbCloseModal(); load(); }, 500);
      }
    });
  };

  window.rbDelete = function() {
    if (!cur) return;
    var r = all.filter(function(x) { return x._key === cur; })[0];
    if (!r || !confirm('Delete "' + (r.title || 'this runbook') + '"?\nThis cannot be undone.')) return;
    kvDel(cur, function(err) {
      if (err) { alert('Delete failed: ' + err.message); return; }
      cur = null;
      document.getElementById('rb-empty').style.display  = 'flex';
      document.getElementById('rb-detail').style.display = 'none';
      load();
    });
  };

  window.rbImport     = function() { document.getElementById('rb-file-input').click(); };
  window.rbCloseModal = function() { document.getElementById('rb-modal-bg').classList.remove('open'); };

  window.rbHandleFile = function(evt) {
    var file = evt.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var name = file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]/g, ' ');
      document.getElementById('rb-f-key').value     = '';
      document.getElementById('rb-f-title').value   = name;
      document.getElementById('rb-f-cat').value     = 'general';
      document.getElementById('rb-f-sev').value     = 'all';
      document.getElementById('rb-f-ver').value     = '1.0';
      document.getElementById('rb-f-author').value  = '';
      document.getElementById('rb-f-tags').value    = '';
      document.getElementById('rb-f-content').value = e.target.result;
      document.getElementById('rb-modal-title').textContent = 'Import: ' + name;
      document.getElementById('rb-save-msg').textContent    = '';
      document.getElementById('rb-modal-bg').classList.add('open');
    };
    reader.readAsText(file);
    evt.target.value = '';
  };

  /* ── Boot ────────────────────────────────────────────────── */
  load();
  setInterval(load, 60000);

}());

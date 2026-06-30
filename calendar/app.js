/* ============================================================
   Content Calendar — Application Logic
   All data is stored in localStorage under the key "cc-v3"
   so it persists across page refreshes.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────

const STORAGE_KEY = 'cc-v3';

const PALETTE = [
  '#FF6B6B','#FF8E53','#F59E0B','#22C55E',
  '#3B82F6','#8B5CF6','#EC4899','#06B6D4',
  '#F97316','#6366F1','#10B981','#EF4444',
];

const STATUS_STYLE = {
  draft:     { bg: '#F1F5F9', color: '#64748B' },
  scheduled: { bg: '#DBEAFE', color: '#1D4ED8' },
  published: { bg: '#DCFCE7', color: '#15803D' },
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DEFAULT_CAMPAIGNS = [
  { id: 'champions', name: '#champions',    color: '#FF8E53' },
  { id: 'blogs',     name: '#blogs',        color: '#3B82F6' },
  { id: 'podcast',   name: '#podcast',      color: '#8B5CF6' },
  { id: 'w360',      name: '#w360 feature', color: '#22C55E' },
  { id: 'wcc',       name: '#wcc',          color: '#EC4899' },
];

// ─────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────

const now = new Date();

const state = {
  posts:      {},       // { [id]: Post }
  campaigns:  {},       // { [id]: Campaign }
  year:       now.getFullYear(),
  month:      now.getMonth(),  // 0-indexed
  view:       'month',  // 'month' | 'week'
  weekStart:  weekStartStr(now),
  filters:    new Set(), // Set of campaignIds to show; empty = show all
  log:        [],        // activity log entries, newest first
};

// ─────────────────────────────────────────────────
// PERSISTENCE  — read / write localStorage
// ─────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.posts     = saved.posts     || {};
      state.campaigns = saved.campaigns || {};
      state.log       = saved.log       || [];
    }
  } catch (e) {
    console.warn('Content Calendar: failed to load saved data', e);
  }

  // Seed default campaigns on first run
  if (!Object.keys(state.campaigns).length) {
    DEFAULT_CAMPAIGNS.forEach(c => { state.campaigns[c.id] = c; });
  }
}

/** Write to the local browser cache only (no cloud push). */
function cacheLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      posts:     state.posts,
      campaigns: state.campaigns,
      log:       state.log,
    }));
  } catch (e) {
    showToast('⚠ Storage full — could not save');
    console.warn('Content Calendar: localStorage quota exceeded', e);
  }
}

/** Save locally and, if a shared calendar is connected, push to the cloud. */
function saveState() {
  cacheLocal();
  schedulePush();
}

let _pushTimer = null;
function schedulePush() {
  if (!(window.Remote && Remote.enabled)) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => Remote.pushAll(state.posts, state.campaigns), 400);
}

function remoteDeletePost(id)     { if (window.Remote && Remote.enabled) Remote.deletePost(id); }
function remoteDeleteCampaign(id) { if (window.Remote && Remote.enabled) Remote.deleteCampaign(id); }

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function uid() {
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Date → 'YYYY-MM-DD' */
function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 'YYYY-MM-DD' → local Date (avoids UTC shift) */
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr() { return dateStr(new Date()); }

/** Return the Sunday that starts the week containing date d */
function weekStartStr(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - dt.getDay());
  return dateStr(dt);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function statusLabel(s) {
  return { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' }[s] || 'Draft';
}

/** Posts for a given date string, sorted by title, filtered by active campaigns */
function postsForDate(date) {
  const all = Object.values(state.posts);
  const filtered = state.filters.size
    ? all.filter(p => state.filters.has(p.campaignId))
    : all;
  return filtered
    .filter(p => p.date === date)
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

// ─────────────────────────────────────────────────
// DRAG STATE
// ─────────────────────────────────────────────────

let dragId      = null;
let isDuplicate = false;
let optionHeld  = false;
let dropTarget  = null;

document.addEventListener('keydown', e => {
  if (e.key === 'Alt') { optionHeld = true;  updateDupeTip(); }
});
document.addEventListener('keyup', e => {
  if (e.key === 'Alt') { optionHeld = false; document.getElementById('dupe-tip').style.display = 'none'; }
});
document.addEventListener('mousemove', e => {
  const tip = document.getElementById('dupe-tip');
  if (tip.style.display === 'block') {
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 22) + 'px';
  }
});

function updateDupeTip() {
  const tip = document.getElementById('dupe-tip');
  tip.style.display = (dragId && optionHeld) ? 'block' : 'none';
}

// ─────────────────────────────────────────────────
// RENDER — top-level
// ─────────────────────────────────────────────────

function render() {
  renderCampaignBar();
  renderCalendar();
  renderPeriodLabel();
}

function renderPeriodLabel() {
  const el = document.getElementById('period-lbl');
  if (state.view === 'month') {
    el.textContent = MONTH_NAMES[state.month] + ' ' + state.year;
  } else {
    const ws = parseDate(state.weekStart);
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    el.textContent =
      MONTH_NAMES[ws.getMonth()] + ' ' + ws.getDate() +
      ' – ' +
      MONTH_NAMES[we.getMonth()] + ' ' + we.getDate() + ', ' + we.getFullYear();
  }
}

function renderCampaignBar() {
  const bar     = document.getElementById('cbar');
  const campBtn = document.getElementById('camp-btn');

  bar.innerHTML = '';

  Object.values(state.campaigns).forEach(c => {
    const pill = document.createElement('button');
    pill.className = 'cpill' + (state.filters.has(c.id) ? ' on' : '');
    pill.style.setProperty('--pc', c.color);
    pill.innerHTML = `<span class="cdot" style="background:${c.color}"></span>${escHtml(c.name)}`;
    pill.addEventListener('click', () => {
      if (state.filters.has(c.id)) state.filters.delete(c.id);
      else                          state.filters.add(c.id);
      renderCampaignBar();
      renderCalendar();
    });
    bar.appendChild(pill);
  });

  bar.appendChild(campBtn); // keep the manage button at the end
}

function renderCalendar() {
  const cal = document.getElementById('cal');
  cal.innerHTML = '';
  state.view === 'month' ? renderMonth(cal) : renderWeek(cal);
}

// ── Month view ──────────────────────────────────

function renderMonth(container) {
  const grid = document.createElement('div');
  grid.className = 'month-grid';

  // Day-of-week headers
  DOW.forEach(name => {
    const h = document.createElement('div');
    h.className = 'dow-hdr';
    h.textContent = name;
    grid.appendChild(h);
  });

  const firstDow    = new Date(state.year, state.month, 1).getDay();
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const prevMonDays = new Date(state.year, state.month, 0).getDate();
  const today       = todayStr();
  const totalCells  = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let date;
    let isOther = false;

    if (i < firstDow) {
      date = new Date(state.year, state.month - 1, prevMonDays - firstDow + i + 1);
      isOther = true;
    } else if (i >= firstDow + daysInMonth) {
      date = new Date(state.year, state.month + 1, i - firstDow - daysInMonth + 1);
      isOther = true;
    } else {
      date = new Date(state.year, state.month, i - firstDow + 1);
    }

    const dStr    = dateStr(date);
    const isToday = dStr === today;

    const cell = document.createElement('div');
    cell.className = 'cal-cell'
      + (isOther  ? ' other' : '')
      + (isToday  ? ' today' : '');
    cell.dataset.date = dStr;
    setupDropTarget(cell, dStr);

    // Header row: day number + add button
    const hdr = document.createElement('div');
    hdr.className = 'cell-hdr';

    const dayNum = document.createElement('div');
    dayNum.className = 'dnum';
    dayNum.textContent = date.getDate();

    const addBtn = document.createElement('button');
    addBtn.className = 'dadd';
    addBtn.title = 'Add post';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', e => { e.stopPropagation(); openNewPost(dStr); });

    hdr.appendChild(dayNum);
    hdr.appendChild(addBtn);
    cell.appendChild(hdr);

    postsForDate(dStr).forEach(p => cell.appendChild(makeCard(p)));
    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

// ── Week view ───────────────────────────────────

function renderWeek(container) {
  const grid = document.createElement('div');
  grid.className = 'week-grid';

  const weekStart = parseDate(state.weekStart);
  const today     = todayStr();

  // Column headers
  for (let i = 0; i < 7; i++) {
    const d    = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dStr = dateStr(d);
    const h    = document.createElement('div');
    h.className = 'wk-hdr' + (dStr === today ? ' today' : '');
    h.innerHTML =
      `<div class="wk-hdr-name">${DOW[d.getDay()]}</div>` +
      `<div class="wk-hdr-num">${d.getDate()}</div>`;
    grid.appendChild(h);
  }

  // Day columns
  for (let i = 0; i < 7; i++) {
    const d    = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dStr = dateStr(d);

    const col = document.createElement('div');
    col.className = 'week-col' + (dStr === today ? ' today' : '');
    col.dataset.date = dStr;
    setupDropTarget(col, dStr);

    const addBtn = document.createElement('button');
    addBtn.className = 'dadd';
    addBtn.style.cssText = 'opacity:1;display:block;width:100%;text-align:center;margin-bottom:4px';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => openNewPost(dStr));
    col.appendChild(addBtn);

    postsForDate(dStr).forEach(p => col.appendChild(makeCard(p)));
    grid.appendChild(col);
  }

  container.appendChild(grid);
}

// ── Post card ───────────────────────────────────

function makeCard(post) {
  const camp  = state.campaigns[post.campaignId];
  const color = camp ? camp.color : '#9B96AE';
  const ss    = STATUS_STYLE[post.status] || STATUS_STYLE.draft;

  const card = document.createElement('div');
  card.className   = 'pcard';
  card.dataset.id  = post.id;
  card.style.background     = hexToRgba(color, .11);
  card.style.borderLeftColor = color;
  card.draggable = true;

  card.innerHTML =
    `<button class="pc-dup" title="Duplicate"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5.5" y="5.5" width="9" height="9" rx="1.6"/><path d="M10.5 5.5V3a1.6 1.6 0 0 0-1.6-1.6H3A1.6 1.6 0 0 0 1.4 3v5.9A1.6 1.6 0 0 0 3 10.5h2.5"/></svg></button>` +
    `<div class="pc-title">${escHtml(post.title || 'Untitled')}</div>` +
    `<div class="pc-bottom">` +
      `<span class="pc-badge" style="background:${ss.bg};color:${ss.color}">${statusLabel(post.status)}</span>` +
      (post.repeatType && post.repeatType !== 'none' ? `<span class="pc-icon" title="Repeating">↻</span>` : '') +
    `</div>`;

  card.querySelector('.pc-dup').addEventListener('click', e => {
    e.stopPropagation();
    duplicatePost(post.id);
  });

  card.addEventListener('click', e => { e.stopPropagation(); openEditPost(post.id); });

  card.addEventListener('dragstart', e => {
    dragId      = post.id;
    optionHeld  = e.altKey;          // read modifier directly from the event
    isDuplicate = e.altKey;
    updateDupeTip();
    e.dataTransfer.effectAllowed = 'copyMove';
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    dragId      = null;
    isDuplicate = false;
    document.getElementById('dupe-tip').style.display = 'none';
    document.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
  });

  return card;
}

// ── Drop targets ────────────────────────────────

function setupDropTarget(el, date) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    optionHeld = e.altKey;           // keep modifier state live during the drag
    updateDupeTip();
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
    if (dropTarget !== el) {
      if (dropTarget) dropTarget.classList.remove('drop-on');
      dropTarget = el;
      el.classList.add('drop-on');
    }
  });

  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('drop-on');
      if (dropTarget === el) dropTarget = null;
    }
  });

  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop-on');
    dropTarget = null;
    if (!dragId) return;

    const post = state.posts[dragId];
    if (!post) return;

    if (e.altKey || isDuplicate || optionHeld) {
      const copy = {
        ...post,
        id:       uid(),
        date,
        parentId: post.id,
        files:    (post.files || []).map(f => ({ ...f })),
      };
      state.posts[copy.id] = copy;
      showToast('Post duplicated ✓');
    } else {
      if (post.date !== date) {
        state.posts[dragId] = { ...post, date };
        showToast('Post moved ✓');
      }
    }

    dragId      = null;
    isDuplicate = false;
    saveState();
    render();
  });
}

// ─────────────────────────────────────────────────
// POST MODAL
// ─────────────────────────────────────────────────

let editingId   = null;  // null = new post
let editBuffer  = null;  // in-progress edits

function openNewPost(date = todayStr()) {
  editingId  = null;
  editBuffer = {
    id:            uid(),
    title:         '',
    date,
    campaignId:    Object.keys(state.campaigns)[0] || '',
    status:        'draft',
    repeatType:    'none',
    repeatEndDate: '',
    parentId:      null,
  };
  buildPostModal(true);
  document.getElementById('post-ov').classList.add('open');
}

function openEditPost(id) {
  editingId  = id;
  const post = state.posts[id];
  editBuffer = { ...post };
  buildPostModal(false);
  document.getElementById('post-ov').classList.add('open');
}

function closePostModal() {
  document.getElementById('post-ov').classList.remove('open');
  editingId  = null;
  editBuffer = null;
}

function buildPostModal(isNew) {
  document.getElementById('post-modal-ttl').textContent = isNew ? 'New post' : 'Edit post';

  const body = document.getElementById('post-modal-body');
  const ftr  = document.getElementById('post-modal-ftr');
  body.innerHTML = '';
  ftr.innerHTML  = '';

  // ── Campaign chips ──────────────────────────
  const campFg    = makeFormGroup('Campaign');
  const chipSet   = document.createElement('div');
  chipSet.className = 'chip-set';

  Object.values(state.campaigns).forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (editBuffer.campaignId === c.id ? ' on' : '');
    chip.style.setProperty('--cc', c.color);
    chip.innerHTML = `<span class="cdot" style="background:${c.color}"></span>${escHtml(c.name)}`;
    chip.addEventListener('click', () => {
      editBuffer.campaignId = c.id;
      chipSet.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      chip.classList.add('on');
    });
    chipSet.appendChild(chip);
  });

  campFg.appendChild(chipSet);
  body.appendChild(campFg);

  // ── Title ───────────────────────────────────
  const titleFg    = makeFormGroup('Post title');
  const titleInput = document.createElement('input');
  titleInput.className   = 'fi';
  titleInput.type        = 'text';
  titleInput.placeholder = 'E.g. Champion spotlight – Aryaman';
  titleInput.value       = editBuffer.title;
  titleInput.addEventListener('input', () => { editBuffer.title = titleInput.value; });
  titleFg.appendChild(titleInput);
  body.appendChild(titleFg);

  // ── Status ──────────────────────────────────
  const statusFg  = makeFormGroup('Status');
  const statusRow = document.createElement('div');
  statusRow.className = 'tri-set';

  [
    { key: 'draft',     label: 'Draft'     },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'published', label: 'Published' },
  ].forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'tri-btn' + (editBuffer.status === key ? ' on' : '');
    btn.style.setProperty('--tc', (STATUS_STYLE[key] || {}).color || 'var(--accent)');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      editBuffer.status = key;
      statusRow.querySelectorAll('.tri-btn').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
    });
    statusRow.appendChild(btn);
  });

  statusFg.appendChild(statusRow);
  body.appendChild(statusFg);

  // ── Repeat ──────────────────────────────────
  const repeatFg  = makeFormGroup('Repeat');
  const repeatRow = document.createElement('div');
  repeatRow.className = 'tri-set';

  const endDateGroup = document.createElement('div');
  endDateGroup.className = 'fg';
  endDateGroup.style.cssText = 'margin-top:8px;display:' + (editBuffer.repeatType !== 'none' ? 'flex' : 'none') + ';flex-direction:column;gap:5px';

  const endLabel = document.createElement('label');
  endLabel.className   = 'fl';
  endLabel.textContent = 'End date (optional)';

  const endInput = document.createElement('input');
  endInput.className = 'fi';
  endInput.type  = 'date';
  endInput.value = editBuffer.repeatEndDate;
  endInput.addEventListener('change', () => { editBuffer.repeatEndDate = endInput.value; });

  endDateGroup.appendChild(endLabel);
  endDateGroup.appendChild(endInput);

  [
    { key: 'none',    label: 'No repeat' },
    { key: 'weekly',  label: '↻ Weekly'  },
    { key: 'monthly', label: '↻ Monthly' },
  ].forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = editBuffer.repeatType === key ? 'tri-btn on' : 'tri-btn on-soft';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      editBuffer.repeatType = key;
      repeatRow.querySelectorAll('.tri-btn').forEach(x => { x.className = 'tri-btn on-soft'; });
      btn.className = 'tri-btn on';
      endDateGroup.style.display = key !== 'none' ? 'flex' : 'none';
    });
    repeatRow.appendChild(btn);
  });

  repeatFg.appendChild(repeatRow);
  repeatFg.appendChild(endDateGroup);
  body.appendChild(repeatFg);

  // ── Footer buttons ───────────────────────────
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-r';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      if (!confirm('Delete this post?')) return;
      // Also delete any repeat children
      Object.keys(state.posts).forEach(id => {
        if (state.posts[id].parentId === editingId) { remoteDeletePost(id); delete state.posts[id]; }
      });
      remoteDeletePost(editingId);
      delete state.posts[editingId];
      saveState();
      render();
      closePostModal();
      showToast('Post deleted');
    });
    ftr.appendChild(delBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className   = 'btn btn-s';
    dupBtn.innerHTML   = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5.5" y="5.5" width="9" height="9" rx="1.6"/><path d="M10.5 5.5V3a1.6 1.6 0 0 0-1.6-1.6H3A1.6 1.6 0 0 0 1.4 3v5.9A1.6 1.6 0 0 0 3 10.5h2.5"/></svg> Duplicate';
    dupBtn.addEventListener('click', () => duplicateCurrentPost());
    ftr.appendChild(dupBtn);
  }

  const spacer = document.createElement('div');
  spacer.className = 'mftr-sp';
  ftr.appendChild(spacer);

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'btn btn-s';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closePostModal);
  ftr.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn btn-p';
  saveBtn.textContent = isNew ? 'Create post' : 'Save changes';
  saveBtn.addEventListener('click', commitPost);
  ftr.appendChild(saveBtn);
}

function commitPost() {
  if (!editBuffer.title) {
    showToast('Add a post title first');
    return;
  }

  const isNew = !editingId;
  const post = { ...editBuffer };

  // Remove old repeat children when re-saving
  if (editingId) {
    Object.keys(state.posts).forEach(id => {
      if (state.posts[id].parentId === editingId) { remoteDeletePost(id); delete state.posts[id]; }
    });
  }

  if (post.repeatType !== 'none') {
    generateRepeatPosts(post);
  }

  state.posts[post.id] = post;
  if (isNew) logActivity('created', post);
  saveState();
  render();
  closePostModal();
  showToast(isNew ? 'Post created ✓' : 'Post updated ✓');
}

function duplicatePost(id) {
  // Copy an existing post to a brand-new post on the same date.
  const src = state.posts[id];
  if (!src) return;
  const copy = {
    ...src,
    id:            uid(),
    parentId:      id,
    repeatType:    'none',   // the copy doesn't inherit the repeat schedule
    repeatEndDate: '',
  };
  state.posts[copy.id] = copy;
  logActivity('duplicated', copy);
  saveState();
  render();
  showToast('Post duplicated ✓');
}

function duplicateCurrentPost() {
  const id = editingId;
  closePostModal();
  duplicatePost(id);
}

function generateRepeatPosts(post) {
  const start = parseDate(post.date);

  let end;
  if (post.repeatEndDate) {
    end = parseDate(post.repeatEndDate);
  } else {
    end = new Date(start);
    if (post.repeatType === 'weekly') end.setDate(end.getDate() + 52 * 7);
    else                              end.setMonth(end.getMonth() + 12);
  }

  const current = new Date(start);

  for (let i = 0; i < 200; i++) {
    if (post.repeatType === 'weekly') current.setDate(current.getDate() + 7);
    else                              current.setMonth(current.getMonth() + 1);
    if (current > end) break;

    const copyId = uid();
    state.posts[copyId] = {
      ...post,
      id:            copyId,
      date:          dateStr(new Date(current)),
      parentId:      post.id,
      repeatType:    'none',   // copies don't themselves repeat
      repeatEndDate: '',
    };
  }
}

// ── Form helper ─────────────────────────────────

function makeFormGroup(label) {
  const group = document.createElement('div');
  group.className = 'fg';

  const lbl = document.createElement('label');
  lbl.className   = 'fl';
  lbl.textContent = label;
  group.appendChild(lbl);

  return group;
}

// ── Download helper ──────────────────────────────

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href     = href;
  a.download = filename;
  a.click();
}

// ─────────────────────────────────────────────────
// CAMPAIGN MODAL
// ─────────────────────────────────────────────────

let newCampaignColor = PALETTE[2]; // default yellow

function openCampaignModal() {
  buildCampaignModal();
  document.getElementById('camp-ov').classList.add('open');
}

function closeCampaignModal() {
  document.getElementById('camp-ov').classList.remove('open');
}

function buildCampaignModal() {
  const body = document.getElementById('camp-modal-body');
  body.innerHTML = '';

  // Existing campaigns list
  const listFg = makeFormGroup('Your campaigns');
  const list   = document.createElement('div');
  list.className = 'camp-list';

  Object.values(state.campaigns).forEach(c => {
    const row = document.createElement('div');
    row.className = 'camp-row';

    const dot = document.createElement('div');
    dot.className = 'crow-dot';
    dot.style.background = c.color;

    const name = document.createElement('span');
    name.className   = 'crow-name';
    name.textContent = c.name;

    const delBtn = document.createElement('button');
    delBtn.className   = 'crow-del';
    delBtn.title       = 'Delete campaign';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      if (Object.keys(state.campaigns).length <= 1) {
        showToast('You need at least one campaign');
        return;
      }
      remoteDeleteCampaign(c.id);
      delete state.campaigns[c.id];
      saveState();
      buildCampaignModal();
      renderCampaignBar();
      render();
    });

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(delBtn);
    list.appendChild(row);
  });

  listFg.appendChild(list);
  body.appendChild(listFg);

  // Divider
  const divider = document.createElement('hr');
  divider.className = 'mdivider';
  body.appendChild(divider);

  // Add new campaign
  const addFg = makeFormGroup('Add new campaign');

  const nameInput = document.createElement('input');
  nameInput.className   = 'fi';
  nameInput.type        = 'text';
  nameInput.placeholder = '#campaign-name';
  addFg.appendChild(nameInput);

  const colorLabel = document.createElement('label');
  colorLabel.className   = 'fl';
  colorLabel.style.marginTop = '8px';
  colorLabel.textContent = 'Color';
  addFg.appendChild(colorLabel);

  const swatches = document.createElement('div');
  swatches.className = 'swatches';

  PALETTE.forEach(color => {
    const sw = document.createElement('button');
    sw.className = 'sw' + (color === newCampaignColor ? ' on' : '');
    sw.style.background = color;
    sw.addEventListener('click', () => {
      newCampaignColor = color;
      swatches.querySelectorAll('.sw').forEach(s => s.classList.remove('on'));
      sw.classList.add('on');
    });
    swatches.appendChild(sw);
  });

  addFg.appendChild(swatches);

  const addBtn = document.createElement('button');
  addBtn.className   = 'btn btn-p';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = '+ Add campaign';
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('Enter a campaign name'); return; }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
    state.campaigns[id] = { id, name, color: newCampaignColor };
    nameInput.value = '';
    saveState();
    buildCampaignModal();
    renderCampaignBar();
    render();
    showToast('Campaign added ✓');
  });

  addFg.appendChild(addBtn);
  body.appendChild(addFg);
}

// ─────────────────────────────────────────────────
// ACTIVITY LOG + BACKUP / SYNC
// ─────────────────────────────────────────────────

/** Record an entry in the activity log (newest first). */
function logActivity(action, post) {
  const camp = state.campaigns[post.campaignId];
  state.log.unshift({
    at:       new Date().toISOString(),
    action,                                   // 'created' | 'duplicated'
    title:    post.title || 'Untitled',
    campaign: camp ? camp.name : '',
    date:     post.date,
  });
  if (state.log.length > 1000) state.log.length = 1000; // keep it bounded
}

function openBackupModal() {
  buildBackupModal();
  document.getElementById('backup-ov').classList.add('open');
}

function closeBackupModal() {
  document.getElementById('backup-ov').classList.remove('open');
}

function buildBackupModal() {
  const body = document.getElementById('backup-modal-body');
  body.innerHTML = '';

  // ── Share / backup explanation ──────────────
  const intro = document.createElement('p');
  intro.style.cssText = 'font-size:12.5px;color:var(--text2);line-height:1.5;margin:-2px 0 2px';
  intro.innerHTML =
    'Your calendar is saved in this browser. To <strong>share it with your team</strong> or move it to another computer, ' +
    'export the file here and have them import it. This is also your backup so nothing gets lost.';
  body.appendChild(intro);

  // ── Export / Import buttons ─────────────────
  const actFg  = makeFormGroup('Backup & share');
  const actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-p';
  exportBtn.textContent = '⬇  Export calendar file';
  exportBtn.addEventListener('click', exportData);

  const importBtn = document.createElement('button');
  importBtn.className = 'btn btn-s';
  importBtn.style.position = 'relative';
  importBtn.textContent = '⬆  Import calendar file';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%';
  importInput.addEventListener('change', () => {
    if (importInput.files.length) importData(importInput.files[0]);
  });
  importBtn.appendChild(importInput);

  actRow.appendChild(exportBtn);
  actRow.appendChild(importBtn);
  actFg.appendChild(actRow);
  body.appendChild(actFg);

  const divider = document.createElement('hr');
  divider.className = 'mdivider';
  body.appendChild(divider);

  // ── Activity log ────────────────────────────
  const logFg     = makeFormGroup('Activity log');
  const logHeader = document.createElement('div');
  logHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:2px';

  const logCount = document.createElement('span');
  logCount.style.cssText = 'font-size:11.5px;color:var(--text3);flex:1';
  logCount.textContent = state.log.length + ' entr' + (state.log.length === 1 ? 'y' : 'ies');

  const logDl = document.createElement('button');
  logDl.className = 'btn btn-s';
  logDl.style.cssText = 'padding:5px 11px;font-size:12px';
  logDl.textContent = 'Download log';
  logDl.addEventListener('click', downloadLog);

  logHeader.appendChild(logCount);
  logHeader.appendChild(logDl);
  logFg.appendChild(logHeader);

  const logList = document.createElement('div');
  logList.className = 'log-list';
  if (!state.log.length) {
    logList.innerHTML = '<div class="log-empty">No activity yet. Create a post to start the log.</div>';
  } else {
    state.log.slice(0, 100).forEach(e => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const when = new Date(e.at);
      const stamp = when.toLocaleDateString() + ' ' +
        when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.innerHTML =
        `<span class="log-act log-${e.action}">${e.action}</span>` +
        `<span class="log-ttl">${escHtml(e.title)}</span>` +
        `<span class="log-meta">${escHtml(e.campaign)} · ${e.date}</span>` +
        `<span class="log-when">${stamp}</span>`;
      logList.appendChild(row);
    });
  }
  logFg.appendChild(logList);
  body.appendChild(logFg);
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    posts:      state.posts,
    campaigns:  state.campaigns,
    log:        state.log,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const stamp = dateStr(new Date());
  triggerDownload(URL.createObjectURL(blob), `content-calendar-${stamp}.json`);
  showToast('Calendar exported ✓');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch (err) {
      showToast('That file isn’t a valid calendar export');
      return;
    }
    if (!data || typeof data !== 'object' || !data.posts) {
      showToast('That file isn’t a valid calendar export');
      return;
    }
    const incoming = Object.keys(data.posts || {}).length;
    if (!confirm(`Import ${incoming} post(s)? This replaces the calendar currently in this browser.`)) return;

    state.posts     = data.posts     || {};
    state.campaigns = data.campaigns || {};
    state.log       = data.log       || [];
    if (!Object.keys(state.campaigns).length) {
      DEFAULT_CAMPAIGNS.forEach(c => { state.campaigns[c.id] = c; });
    }
    saveState();
    render();
    buildBackupModal();
    showToast('Calendar imported ✓');
  };
  reader.readAsText(file);
}

function downloadLog() {
  const lines = state.log.map(e => {
    const when = new Date(e.at).toLocaleString();
    return `[${when}] ${e.action.toUpperCase()} — "${e.title}" (${e.campaign || 'no campaign'}) on ${e.date}`;
  });
  const header = 'CONTENT CALENDAR — ACTIVITY LOG\nGenerated ' + new Date().toLocaleString() + '\n' + '='.repeat(48) + '\n\n';
  const blob = new Blob([header + lines.join('\n') + '\n'], { type: 'text/plain' });
  triggerDownload(URL.createObjectURL(blob), `content-calendar-log-${dateStr(new Date())}.txt`);
  showToast('Log downloaded ✓');
}

// ─────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────

function prevPeriod() {
  if (state.view === 'month') {
    state.month--;
    if (state.month < 0) { state.month = 11; state.year--; }
  } else {
    const ws = parseDate(state.weekStart);
    ws.setDate(ws.getDate() - 7);
    state.weekStart = dateStr(ws);
  }
  render();
}

function nextPeriod() {
  if (state.view === 'month') {
    state.month++;
    if (state.month > 11) { state.month = 0; state.year++; }
  } else {
    const ws = parseDate(state.weekStart);
    ws.setDate(ws.getDate() + 7);
    state.weekStart = dateStr(ws);
  }
  render();
}

function goToday() {
  const n = new Date();
  state.year      = n.getFullYear();
  state.month     = n.getMonth();
  state.weekStart = weekStartStr(n);
  render();
}

// ─────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────

let toastTimer;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ─────────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────────

document.getElementById('prev-btn').addEventListener('click', prevPeriod);
document.getElementById('next-btn').addEventListener('click', nextPeriod);
document.getElementById('today-btn').addEventListener('click', goToday);
document.getElementById('new-btn').addEventListener('click', () => openNewPost());
document.getElementById('camp-btn').addEventListener('click', openCampaignModal);
document.getElementById('backup-btn').addEventListener('click', openBackupModal);

document.getElementById('backup-modal-x').addEventListener('click', closeBackupModal);
document.getElementById('backup-ov').addEventListener('click', e => {
  if (e.target === document.getElementById('backup-ov')) closeBackupModal();
});

document.getElementById('post-modal-x').addEventListener('click', closePostModal);
document.getElementById('post-ov').addEventListener('click', e => {
  if (e.target === document.getElementById('post-ov')) closePostModal();
});

document.getElementById('camp-modal-x').addEventListener('click', closeCampaignModal);
document.getElementById('camp-ov').addEventListener('click', e => {
  if (e.target === document.getElementById('camp-ov')) closeCampaignModal();
});

document.querySelectorAll('.vtbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    document.querySelectorAll('.vtbtn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    if (state.view === 'week') {
      state.weekStart = weekStartStr(new Date(state.year, state.month, 1));
    }
    render();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePostModal(); closeCampaignModal(); closeBackupModal(); }
});

// ─────────────────────────────────────────────────
// CLOUD SYNC (Supabase) — optional, enabled via config.js
// ─────────────────────────────────────────────────

function setSyncStatus(mode) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    connecting: { txt: 'Connecting…', cls: 'sync-connecting' },
    synced:     { txt: 'Shared · live', cls: 'sync-on' },
    local:      { txt: 'Local only', cls: 'sync-off' },
  };
  const s = map[mode] || map.local;
  el.textContent = s.txt;
  el.className = 'sync-pill ' + s.cls;
  el.title = mode === 'synced'
    ? 'Connected to your shared calendar — changes sync live across everyone.'
    : mode === 'local'
      ? 'Data is saved only in this browser. Add Supabase keys in config.js to share.'
      : 'Connecting to the shared calendar…';
}

/** Replace local state with the shared cloud copy and re-render (no push-back). */
async function syncPull() {
  const data = await Remote.pull();
  if (!data) return;

  const remoteEmpty = !Object.keys(data.posts).length && !Object.keys(data.campaigns).length;
  const haveLocal   = Object.keys(state.posts).length || Object.keys(state.campaigns).length;

  // First-ever connection with an empty cloud: seed it from this browser's data.
  if (remoteEmpty && haveLocal) {
    await Remote.pushAll(state.posts, state.campaigns);
    return;
  }

  state.posts     = data.posts;
  state.campaigns = Object.keys(data.campaigns).length ? data.campaigns : state.campaigns;
  if (!Object.keys(state.campaigns).length) {
    DEFAULT_CAMPAIGNS.forEach(c => { state.campaigns[c.id] = c; });
  }
  cacheLocal();
  render();
}

async function initCloud() {
  if (!(window.Remote && Remote.configured())) { setSyncStatus('local'); return; }
  setSyncStatus('connecting');
  const ok = await Remote.init(() => syncPull());  // live-change handler
  if (!ok) { setSyncStatus('local'); return; }
  await syncPull();
  setSyncStatus('synced');
}

// ─────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────

loadState();   // instant render from local cache
render();
initCloud();   // then connect to the shared calendar (if configured)

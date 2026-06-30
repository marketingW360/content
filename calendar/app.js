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
    }
  } catch (e) {
    console.warn('Content Calendar: failed to load saved data', e);
  }

  // Seed default campaigns on first run
  if (!Object.keys(state.campaigns).length) {
    DEFAULT_CAMPAIGNS.forEach(c => { state.campaigns[c.id] = c; });
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      posts:     state.posts,
      campaigns: state.campaigns,
    }));
  } catch (e) {
    // Storage quota exceeded (common with base64 images)
    showToast('⚠ Storage full — large file attachments may not persist');
    console.warn('Content Calendar: localStorage quota exceeded', e);
  }
}

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

function formatFileSize(bytes) {
  if (bytes < 1024)    return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

function fileIcon(mimeType) {
  if (!mimeType)                         return '📄';
  if (mimeType.startsWith('image/'))     return '🖼';
  if (mimeType.startsWith('video/'))     return '🎬';
  if (mimeType === 'application/pdf')    return '📕';
  return '📄';
}

function statusLabel(s) {
  return { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' }[s] || 'Draft';
}

/** Posts for a given date string, sorted by time, filtered by active campaigns */
function postsForDate(date) {
  const all = Object.values(state.posts);
  const filtered = state.filters.size
    ? all.filter(p => state.filters.has(p.campaignId))
    : all;
  return filtered
    .filter(p => p.date === date)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
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
    `<div class="pc-title">${escHtml(post.title || 'Untitled')}</div>` +
    `<div class="pc-bottom">` +
      (post.time ? `<span class="pc-time">${post.time}</span>` : '') +
      `<span class="pc-badge" style="background:${ss.bg};color:${ss.color}">${statusLabel(post.status)}</span>` +
      (post.repeatType && post.repeatType !== 'none' ? `<span class="pc-icon" title="Repeating">↻</span>` : '') +
      (post.files && post.files.length ? `<span class="pc-icon" title="Has files">📎</span>` : '') +
    `</div>`;

  card.addEventListener('click', e => { e.stopPropagation(); openEditPost(post.id); });

  card.addEventListener('dragstart', e => {
    dragId      = post.id;
    isDuplicate = optionHeld;
    updateDupeTip();
    e.dataTransfer.effectAllowed = isDuplicate ? 'copy' : 'move';
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
    e.dataTransfer.dropEffect = optionHeld ? 'copy' : 'move';
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

    if (isDuplicate || optionHeld) {
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
    text:          '',
    date,
    time:          '',
    campaignId:    Object.keys(state.campaigns)[0] || '',
    status:        'draft',
    repeatType:    'none',
    repeatEndDate: '',
    files:         [],
    parentId:      null,
  };
  buildPostModal(true);
  document.getElementById('post-ov').classList.add('open');
}

function openEditPost(id) {
  editingId  = id;
  const post = state.posts[id];
  editBuffer = { ...post, files: (post.files || []).map(f => ({ ...f })) };
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

  // ── Post text ───────────────────────────────
  const textFg   = makeFormGroup('Post content');
  const textarea = document.createElement('textarea');
  textarea.className   = 'fta';
  textarea.placeholder = 'Write your LinkedIn post content here…';
  textarea.value       = editBuffer.text;

  const charCount = document.createElement('div');
  charCount.className = 'char-ct';

  const updateCharCount = () => {
    const len = textarea.value.length;
    editBuffer.text = textarea.value;
    charCount.textContent = `${len.toLocaleString()} / 3,000`;
    charCount.className = 'char-ct'
      + (len > 3000 ? ' over' : len > 2700 ? ' warn' : '');
  };
  textarea.addEventListener('input', updateCharCount);
  updateCharCount();

  textFg.appendChild(textarea);
  textFg.appendChild(charCount);
  body.appendChild(textFg);

  // ── Date & Time ─────────────────────────────
  const dtRow = document.createElement('div');
  dtRow.className = 'frow';

  const dateFg    = makeFormGroup('Date');
  const dateInput = document.createElement('input');
  dateInput.className = 'fi';
  dateInput.type  = 'date';
  dateInput.value = editBuffer.date;
  dateInput.addEventListener('change', () => { editBuffer.date = dateInput.value; });
  dateFg.appendChild(dateInput);
  dtRow.appendChild(dateFg);

  const timeFg    = makeFormGroup('Time');
  const timeInput = document.createElement('input');
  timeInput.className = 'fi';
  timeInput.type  = 'time';
  timeInput.value = editBuffer.time;
  timeInput.addEventListener('change', () => { editBuffer.time = timeInput.value; });
  timeFg.appendChild(timeInput);
  dtRow.appendChild(timeFg);

  body.appendChild(dtRow);

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

  // ── File attachments ─────────────────────────
  const filesFg  = makeFormGroup('Attachments');
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  dropZone.innerHTML =
    `<div class="dz-icon">📎</div>` +
    `<div class="dz-txt">Drag files here or <strong>browse</strong></div>` +
    `<input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.txt">`;

  const fileInput = dropZone.querySelector('input');
  const fileList  = document.createElement('div');
  fileList.className = 'flist';

  const renderFileList = () => {
    fileList.innerHTML = '';
    editBuffer.files.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'fitem';

      const thumb = document.createElement('div');
      thumb.className = 'fthumb';
      if (f.dataUrl && f.type && f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = f.dataUrl;
        thumb.appendChild(img);
      } else {
        thumb.textContent = fileIcon(f.type);
      }

      const fname = document.createElement('span');
      fname.className = 'fname';
      fname.title     = f.name;
      fname.textContent = f.name;

      const fsize = document.createElement('span');
      fsize.className   = 'fsize';
      fsize.textContent = formatFileSize(f.size || 0);

      const dlBtn = document.createElement('button');
      dlBtn.className   = 'ficon-btn dl';
      dlBtn.title       = 'Download';
      dlBtn.textContent = '⬇';
      dlBtn.addEventListener('click', () => downloadFile(f));

      const rmBtn = document.createElement('button');
      rmBtn.className   = 'ficon-btn rm';
      rmBtn.title       = 'Remove';
      rmBtn.textContent = '×';
      rmBtn.addEventListener('click', () => {
        editBuffer.files.splice(idx, 1);
        renderFileList();
      });

      item.appendChild(thumb);
      item.appendChild(fname);
      item.appendChild(fsize);
      item.appendChild(dlBtn);
      item.appendChild(rmBtn);
      fileList.appendChild(item);
    });
  };

  const addFiles = async files => {
    for (const f of files) {
      const dataUrl = await readFileAsBase64(f);
      editBuffer.files.push({ name: f.name, size: f.size, type: f.type, dataUrl });
    }
    renderFileList();
  };

  fileInput.addEventListener('change', () => addFiles(Array.from(fileInput.files)));
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-on'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-on'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-on');
    if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
  });

  renderFileList();
  filesFg.appendChild(dropZone);
  filesFg.appendChild(fileList);
  body.appendChild(filesFg);

  // ── LinkedIn export ─────────────────────────
  const divider = document.createElement('hr');
  divider.className = 'mdivider';
  body.appendChild(divider);

  const liBox = document.createElement('div');
  liBox.className = 'li-box';
  liBox.innerHTML =
    `<div class="li-hdr">` +
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="#1D4ED8"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` +
      `Export for LinkedIn` +
    `</div>` +
    `<div class="li-btns" id="li-btns"></div>`;

  const liButtons = liBox.querySelector('#li-btns');

  const addLiBtn = (icon, label, handler) => {
    const btn = document.createElement('button');
    btn.className = 'li-btn';
    btn.innerHTML = `${icon} ${label}`;
    btn.addEventListener('click', handler);
    liButtons.appendChild(btn);
  };

  addLiBtn('📋', 'Copy text', () => {
    const text = buildPostText();
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied to clipboard ✓'))
      .catch(() => {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied ✓');
      });
  });

  addLiBtn('📄', 'Download .txt', () => {
    const blob = new Blob([buildPostText()], { type: 'text/plain' });
    triggerDownload(URL.createObjectURL(blob), (editBuffer.title || 'post') + '.txt');
  });

  if (editBuffer.files.length) {
    addLiBtn('⬇', 'Download all files', () => {
      editBuffer.files.forEach(f => downloadFile(f));
    });
  }

  body.appendChild(liBox);

  // ── Footer buttons ───────────────────────────
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-r';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      if (!confirm('Delete this post?')) return;
      // Also delete any repeat children
      Object.keys(state.posts).forEach(id => {
        if (state.posts[id].parentId === editingId) delete state.posts[id];
      });
      delete state.posts[editingId];
      saveState();
      render();
      closePostModal();
      showToast('Post deleted');
    });
    ftr.appendChild(delBtn);
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

/** Build the "title + body" text for LinkedIn export */
function buildPostText() {
  const parts = [];
  if (editBuffer.title) parts.push(editBuffer.title);
  if (editBuffer.text)  parts.push(editBuffer.text);
  return parts.join('\n\n').trim();
}

function commitPost() {
  if (!editBuffer.title && !editBuffer.text) {
    showToast('Add a title or content first');
    return;
  }

  const post = { ...editBuffer };

  // Remove old repeat children when re-saving
  if (editingId) {
    Object.keys(state.posts).forEach(id => {
      if (state.posts[id].parentId === editingId) delete state.posts[id];
    });
  }

  if (post.repeatType !== 'none') {
    generateRepeatPosts(post);
  }

  state.posts[post.id] = post;
  saveState();
  render();
  closePostModal();
  showToast(editingId ? 'Post updated ✓' : 'Post created ✓');
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

// ── File helpers ─────────────────────────────────

function readFileAsBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

function downloadFile(f) {
  if (!f.dataUrl) { showToast('No file data available'); return; }
  triggerDownload(f.dataUrl, f.name);
}

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
  if (e.key === 'Escape') { closePostModal(); closeCampaignModal(); }
});

// ─────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────

loadState();
render();

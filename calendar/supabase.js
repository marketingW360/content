/* ============================================================
   Supabase sync layer
   ------------------------------------------------------------
   Exposes a single global `Remote` object that app.js uses to
   push local changes to the cloud, pull the shared calendar,
   and listen for changes made by teammates (live realtime).

   If config.js still holds placeholder values, Remote stays
   disabled and the app runs purely on localStorage.
   ============================================================ */

window.Remote = (function () {
  'use strict';

  let client     = null;
  let enabled    = false;
  let onChangeCb = null;
  let changeTimer = null;

  /** True only when real credentials have been pasted into config.js */
  function configured() {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    return typeof url === 'string' && url && !url.includes('YOUR-PROJECT')
        && typeof key === 'string' && key && !key.includes('YOUR-ANON');
  }

  // ── Map between app objects (camelCase) and DB rows (snake_case) ──

  function postToRow(p) {
    return {
      id:              p.id,
      title:           p.title || '',
      date:            p.date || null,
      campaign_id:     p.campaignId || null,
      status:          p.status || 'draft',
      repeat_type:     p.repeatType || 'none',
      repeat_end_date: p.repeatEndDate || null,
      parent_id:       p.parentId || null,
    };
  }

  function rowToPost(r) {
    return {
      id:            r.id,
      title:         r.title || '',
      date:          r.date,
      campaignId:    r.campaign_id || '',
      status:        r.status || 'draft',
      repeatType:    r.repeat_type || 'none',
      repeatEndDate: r.repeat_end_date || '',
      parentId:      r.parent_id || null,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────

  /** Connect + subscribe to live changes. Returns true if connected. */
  async function init(onChange) {
    if (!configured() || !window.supabase) return false;
    try {
      client     = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      enabled    = true;
      onChangeCb = onChange;

      client.channel('calendar-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts'     }, scheduleChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, scheduleChange)
        .subscribe();

      return true;
    } catch (e) {
      console.warn('Supabase: failed to initialise', e);
      enabled = false;
      return false;
    }
  }

  // Debounce bursts of remote changes into a single refresh
  function scheduleChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { if (onChangeCb) onChangeCb(); }, 250);
  }

  // ── Data operations ──────────────────────────────────────

  /** Fetch the whole shared calendar. Returns {posts, campaigns} or null on error. */
  async function pull() {
    if (!enabled) return null;
    try {
      const [postsRes, campsRes] = await Promise.all([
        client.from('posts').select('*'),
        client.from('campaigns').select('*'),
      ]);
      if (postsRes.error || campsRes.error) {
        console.warn('Supabase pull error', postsRes.error || campsRes.error);
        return null;
      }
      const posts = {};
      (postsRes.data || []).forEach(r => { posts[r.id] = rowToPost(r); });
      const campaigns = {};
      (campsRes.data || []).forEach(r => { campaigns[r.id] = { id: r.id, name: r.name, color: r.color }; });
      return { posts, campaigns };
    } catch (e) {
      console.warn('Supabase pull failed', e);
      return null;
    }
  }

  /** Upsert all current posts + campaigns (never deletes — safe for concurrency). */
  async function pushAll(posts, campaigns) {
    if (!enabled) return;
    try {
      const campRows = Object.values(campaigns).map(c => ({ id: c.id, name: c.name, color: c.color }));
      const postRows = Object.values(posts).map(postToRow);
      if (campRows.length) await client.from('campaigns').upsert(campRows);
      if (postRows.length) await client.from('posts').upsert(postRows);
    } catch (e) {
      console.warn('Supabase push failed', e);
    }
  }

  async function deletePost(id) {
    if (!enabled) return;
    try { await client.from('posts').delete().eq('id', id); }
    catch (e) { console.warn('Supabase delete post failed', e); }
  }

  async function deleteCampaign(id) {
    if (!enabled) return;
    try { await client.from('campaigns').delete().eq('id', id); }
    catch (e) { console.warn('Supabase delete campaign failed', e); }
  }

  return {
    get enabled() { return enabled; },
    configured,
    init,
    pull,
    pushAll,
    deletePost,
    deleteCampaign,
  };
})();

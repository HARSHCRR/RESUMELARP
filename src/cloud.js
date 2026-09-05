/**
 * cloud.js — Supabase integration layer for Resume Recall Map
 * 
 * Handles: Auth (Google/GitHub OAuth), Cloud persistence, Real-time sync,
 * Collaboration (share links + presence).
 * 
 * Communicates with the main app via window.RecallMap API.
 */

import { createClient } from '@supabase/supabase-js';

// ── Supabase init ──────────────────────────────────────────
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let currentUser = null;
let realtimeChannel = null;
let presenceChannel = null;
let suppressNextSync = false; // prevent echo when we save our own changes

function isReady() {
  return !!(supabase && currentUser);
}

function initSupabase() {
  if (!SUPA_URL || !SUPA_KEY || SUPA_URL.includes('your-project')) {
    console.log('[cloud] Supabase not configured — running in local-only mode');
    return false;
  }
  supabase = createClient(SUPA_URL, SUPA_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return true;
}

// ── Auth ───────────────────────────────────────────────────

async function signInWithGoogle() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) console.error('[cloud] Google sign-in error:', error.message);
}

async function signInWithGitHub() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) console.error('[cloud] GitHub sign-in error:', error.message);
}

async function signOut() {
  if (!supabase) return;
  unsubscribeRealtime();
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[cloud] Sign-out error:', error.message);
  currentUser = null;
  updateAuthUI(null);
}

function onAuthStateChange(callback) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    updateAuthUI(currentUser);
    if (callback) callback(event, currentUser);

    if (event === 'SIGNED_IN' && currentUser) {
      // Sync local maps to cloud on first sign-in
      await syncLocalMapsToCloud();
      await refreshCloudMaps();
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
    }
  });
}

// ── Auth UI ────────────────────────────────────────────────

function updateAuthUI(user) {
  const authArea = document.getElementById('authArea');
  const shareBtn = document.getElementById('bShare');
  if (!authArea) return;

  if (user) {
    const avatar = user.user_metadata?.avatar_url || '';
    const name = user.user_metadata?.full_name || user.email || 'User';
    const initial = name.charAt(0).toUpperCase();

    authArea.innerHTML = `
      <div class="auth-user" id="authUser">
        ${avatar
          ? `<img class="auth-avatar" src="${avatar}" alt="${name}" title="${name}" />`
          : `<span class="auth-avatar auth-initial" title="${name}">${initial}</span>`
        }
        <button class="btn ghost sm" id="bLogout" style="font-size:11px;height:24px;padding:0 8px">Sign out</button>
      </div>
    `;
    document.getElementById('bLogout').onclick = signOut;
    if (shareBtn) shareBtn.hidden = false;

    // Update save chip
    const app = window.RecallMap;
    if (app) app.setSave('ok', 'cloud · ' + (user.email || 'signed in'));
  } else {
    authArea.innerHTML = `
      <button class="btn ghost sm" id="bLogin" style="font-size:11px;height:24px;padding:0 10px">Sign in</button>
    `;
    document.getElementById('bLogin').onclick = () => {
      const modal = document.getElementById('mAuth');
      if (modal) modal.hidden = false;
    };
    if (shareBtn) shareBtn.hidden = true;
  }
}

// ── Cloud CRUD ─────────────────────────────────────────────

async function loadCloudMaps() {
  if (!isReady()) return [];
  const { data, error } = await supabase
    .from('maps')
    .select('id, title, updated_at, is_public, share_code')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (error) { console.error('[cloud] loadCloudMaps:', error.message); return []; }
  return data || [];
}

async function loadSharedMaps() {
  if (!isReady()) return [];
  const { data, error } = await supabase
    .from('collaborators')
    .select('map_id, role, maps:map_id(id, title, updated_at, is_public, share_code, user_id)')
    .eq('user_id', currentUser.id);

  if (error) { console.error('[cloud] loadSharedMaps:', error.message); return []; }
  return (data || []).map(d => ({ ...d.maps, role: d.role, shared: true })).filter(Boolean);
}

async function loadCloudMap(cloudId) {
  if (!isReady()) return null;
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('id', cloudId)
    .single();

  if (error) { console.error('[cloud] loadCloudMap:', error.message); return null; }
  return data;
}

async function loadMapByShareCode(code) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('share_code', code)
    .single();

  if (error) { console.error('[cloud] loadMapByShareCode:', error.message); return null; }
  return data;
}

async function saveCloudMap(cloudId, title, docData) {
  if (!isReady()) return null;
  suppressNextSync = true;

  const payload = {
    title,
    data: docData,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('maps')
    .update(payload)
    .eq('id', cloudId)
    .select()
    .single();

  if (error) {
    console.error('[cloud] saveCloudMap:', error.message);
    suppressNextSync = false;
    return null;
  }

  // Reset suppression after a short delay
  setTimeout(() => { suppressNextSync = false; }, 1000);
  return data;
}

async function createCloudMap(title, docData) {
  if (!isReady()) return null;

  const { data, error } = await supabase
    .from('maps')
    .insert({
      user_id: currentUser.id,
      title,
      data: docData,
    })
    .select()
    .single();

  if (error) { console.error('[cloud] createCloudMap:', error.message); return null; }
  return data;
}

async function deleteCloudMap(cloudId) {
  if (!isReady()) return false;
  const { error } = await supabase
    .from('maps')
    .delete()
    .eq('id', cloudId);

  if (error) { console.error('[cloud] deleteCloudMap:', error.message); return false; }
  return true;
}

// ── Sharing ────────────────────────────────────────────────

async function togglePublic(cloudId, isPublic) {
  if (!isReady()) return null;
  const { data, error } = await supabase
    .from('maps')
    .update({ is_public: isPublic })
    .eq('id', cloudId)
    .select('share_code')
    .single();

  if (error) { console.error('[cloud] togglePublic:', error.message); return null; }
  return data?.share_code;
}

function getShareUrl(shareCode) {
  return `${window.location.origin}${window.location.pathname}?share=${shareCode}`;
}

async function addCollaborator(cloudId, email, role = 'editor') {
  if (!isReady()) return false;
  // Look up user by email — this requires the user to have an account
  const { data: users } = await supabase.auth.admin?.listUsers?.();
  // For simplicity, we'll use the share link approach instead
  console.warn('[cloud] addCollaborator by email not implemented — use share links');
  return false;
}

// ── Real-time sync ─────────────────────────────────────────

function subscribeToMap(cloudId) {
  unsubscribeRealtime();
  if (!supabase || !cloudId) return;

  // Database changes subscription
  realtimeChannel = supabase
    .channel('map-changes-' + cloudId)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'maps',
        filter: `id=eq.${cloudId}`,
      },
      (payload) => {
        if (suppressNextSync) return;
        const newData = payload.new?.data;
        if (newData && window.RecallMap) {
          console.log('[cloud] Real-time update received');
          window.RecallMap.adopt(newData);
          window.RecallMap.setSave('ok', 'synced · live');
        }
      }
    )
    .subscribe();

  // Presence subscription
  presenceChannel = supabase.channel('presence-' + cloudId);
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      updatePresenceUI(state);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && currentUser) {
        await presenceChannel.track({
          user_id: currentUser.id,
          email: currentUser.email,
          name: currentUser.user_metadata?.full_name || currentUser.email,
          avatar: currentUser.user_metadata?.avatar_url || '',
          online_at: new Date().toISOString(),
        });
      }
    });
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    supabase?.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (presenceChannel) {
    supabase?.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  updatePresenceUI({});
}

function updatePresenceUI(state) {
  let el = document.getElementById('presenceBar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'presenceBar';
    el.className = 'presence-bar';
    const bar = document.querySelector('.bar');
    if (bar) bar.appendChild(el);
  }

  const users = Object.values(state).flat().filter(u => u.user_id !== currentUser?.id);

  if (!users.length) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }

  el.hidden = false;
  el.innerHTML = users.map(u => {
    if (u.avatar) {
      return `<img class="presence-dot" src="${u.avatar}" title="${u.name || u.email}" />`;
    }
    const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
    return `<span class="presence-dot presence-initial" title="${u.name || u.email}">${initial}</span>`;
  }).join('');
}

// ── Sync local → cloud ────────────────────────────────────

async function syncLocalMapsToCloud() {
  if (!isReady()) return;
  const app = window.RecallMap;
  if (!app) return;

  const index = app.getIndex();
  if (!index || !index.maps) return;

  // Check for maps that exist locally but not in cloud
  const cloudMaps = await loadCloudMaps();
  const cloudTitles = new Set(cloudMaps.map(m => m.title));

  for (const [localId, meta] of Object.entries(index.maps)) {
    // Skip if already has a cloud ID linked
    if (meta.cloudId) continue;

    // Load local map data
    let localData = null;
    try {
      const j = localStorage.getItem('recallmap.data.' + localId);
      if (j) localData = JSON.parse(j);
    } catch (e) { continue; }

    if (!localData || !localData.nodes || !Object.keys(localData.nodes).length) continue;
    if (localData.sample) continue; // Don't sync sample maps

    // Create in cloud
    const cloud = await createCloudMap(meta.title || 'Untitled', localData);
    if (cloud) {
      meta.cloudId = cloud.id;
      meta.cloudShareCode = cloud.share_code;
      console.log('[cloud] Synced local map to cloud:', meta.title);
    }
  }

  app.saveIndex();
}

async function refreshCloudMaps() {
  if (!isReady()) return;
  const app = window.RecallMap;
  if (!app) return;

  const cloudMaps = await loadCloudMaps();
  const index = app.getIndex();

  // Update local index with cloud info
  for (const cm of cloudMaps) {
    // Find local map linked to this cloud map
    let found = false;
    for (const [localId, meta] of Object.entries(index.maps)) {
      if (meta.cloudId === cm.id) {
        meta.title = cm.title;
        meta.updated = new Date(cm.updated_at).getTime();
        meta.cloudShareCode = cm.share_code;
        meta.isPublic = cm.is_public;
        found = true;
        break;
      }
    }

    // If cloud map doesn't exist locally, create a local reference
    if (!found) {
      const localId = Math.random().toString(36).slice(2, 9);
      index.maps[localId] = {
        id: localId,
        title: cm.title,
        updated: new Date(cm.updated_at).getTime(),
        cloudId: cm.id,
        cloudShareCode: cm.share_code,
        isPublic: cm.is_public,
      };
      // Cache the data locally too
      try {
        localStorage.setItem('recallmap.data.' + localId, JSON.stringify(cm.data));
      } catch (e) { /* localStorage might be full */ }
    }
  }

  app.saveIndex();
}

// ── Cloud-aware save (replaces local-only save) ────────────

async function cloudSave(localMapId, docJson) {
  if (!isReady()) return;
  const app = window.RecallMap;
  if (!app) return;

  const index = app.getIndex();
  const meta = index.maps[localMapId];
  if (!meta) return;

  const doc = JSON.parse(docJson);

  if (meta.cloudId) {
    // Update existing cloud map
    const result = await saveCloudMap(meta.cloudId, doc.title || meta.title, doc);
    if (result) {
      app.setSave('ok', 'saved · cloud');
    } else {
      app.setSave('warn', 'cloud sync failed');
    }
  } else {
    // First cloud save — create
    if (doc.sample) return; // Don't sync sample
    const result = await createCloudMap(doc.title || 'Untitled', doc);
    if (result) {
      meta.cloudId = result.id;
      meta.cloudShareCode = result.share_code;
      app.saveIndex();
      app.setSave('ok', 'saved · cloud');
      // Start real-time subscription
      subscribeToMap(result.id);
    }
  }
}

// ── Cloud-aware load ───────────────────────────────────────

async function cloudLoad(localMapId) {
  if (!isReady()) return null;
  const app = window.RecallMap;
  if (!app) return null;

  const index = app.getIndex();
  const meta = index.maps[localMapId];
  if (!meta?.cloudId) return null;

  const cloud = await loadCloudMap(meta.cloudId);
  if (!cloud) return null;

  // Subscribe to real-time changes for this map
  subscribeToMap(meta.cloudId);

  return cloud.data;
}

// ── Share handling ─────────────────────────────────────────

async function handleShareCode() {
  const params = new URLSearchParams(window.location.search);
  const shareCode = params.get('share');
  if (!shareCode) return false;

  // Load the shared map
  const map = await loadMapByShareCode(shareCode);
  if (!map) {
    console.warn('[cloud] No map found for share code:', shareCode);
    return false;
  }

  const app = window.RecallMap;
  if (!app) return false;

  // Adopt the shared map data
  app.adopt(map.data);
  app.setSave('ok', 'shared map · read-only');

  // Subscribe to real-time updates
  subscribeToMap(map.id);

  // Clean up URL
  window.history.replaceState({}, '', window.location.pathname);

  return true;
}

// ── Boot ───────────────────────────────────────────────────

async function boot() {
  if (!initSupabase()) {
    // No Supabase configured — app runs in local-only mode
    return;
  }

  // Add auth CSS
  injectStyles();

  // Add auth UI elements to DOM
  injectAuthUI();

  // Set up auth modal handlers
  setupAuthModal();

  // Check for share code in URL
  const isShared = await handleShareCode();

  // Listen for auth state changes
  onAuthStateChange(async (event, user) => {
    if (user && !isShared) {
      // Start real-time for current map
      const app = window.RecallMap;
      if (app) {
        const index = app.getIndex();
        const currentId = app.getMapId();
        const meta = index.maps[currentId];
        if (meta?.cloudId) {
          subscribeToMap(meta.cloudId);
        }
      }
    }
  });

  // Check current session
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    updateAuthUI(currentUser);
    await syncLocalMapsToCloud();
    await refreshCloudMaps();

    // Subscribe to current map if it has a cloud ID
    const app = window.RecallMap;
    if (app) {
      const index = app.getIndex();
      const currentId = app.getMapId();
      const meta = index.maps[currentId];
      if (meta?.cloudId) {
        subscribeToMap(meta.cloudId);
      }
    }
  }

  // Hook into the app's save cycle
  hookIntoSave();
}

function hookIntoSave() {
  const app = window.RecallMap;
  if (!app) {
    // Retry in 500ms if app isn't ready yet
    setTimeout(hookIntoSave, 500);
    return;
  }

  // Monkey-patch the save to also save to cloud
  const origSave = app._origSave || app.save;
  app._origSave = origSave;

  app.save = async function () {
    // Call original save (localStorage)
    await origSave();
    // Also save to cloud if authenticated
    if (isReady()) {
      const mapId = app.getMapId();
      const json = app.serialize();
      await cloudSave(mapId, json);
    }
  };

  // Hook into map load to also load from cloud
  const origLoadMap = app._origLoadMap || app.loadMap;
  app._origLoadMap = origLoadMap;

  app.loadMap = async function (id) {
    // First load from local (fast)
    origLoadMap(id);

    // Then check cloud for newer version
    if (isReady()) {
      const cloudData = await cloudLoad(id);
      if (cloudData) {
        const localDoc = JSON.parse(app.serialize());
        // If cloud is newer, adopt it
        if ((cloudData.updatedAt || 0) > (localDoc.updatedAt || 0)) {
          app.adopt(cloudData);
          app.setSave('ok', 'synced · cloud');
        }
      }
    }
  };
}

// ── Inject DOM elements ────────────────────────────────────

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Auth UI */
    .auth-user { display:flex; align-items:center; gap:6px; }
    .auth-avatar {
      width:24px; height:24px; border-radius:50%; border:1.5px solid var(--border-2);
      object-fit:cover; cursor:pointer;
    }
    .auth-initial {
      display:grid; place-items:center; background:var(--surface-3);
      font-size:11px; font-weight:600; color:var(--text);
    }
    #authArea { display:flex; align-items:center; gap:6px; flex:none; }

    /* Auth modal */
    .auth-btns { display:flex; flex-direction:column; gap:10px; margin-top:18px; }
    .auth-btns .btn {
      height:42px; font-size:14px; font-weight:500; justify-content:center; gap:10px;
      border-radius:8px;
    }
    .auth-btns .btn svg { width:20px; height:20px; }
    .auth-btns .btn.google-btn { background:#fff; color:#333; border-color:#ddd; }
    .auth-btns .btn.google-btn:hover { background:#f7f7f7; }
    .auth-btns .btn.github-btn { background:#24292e; color:#fff; border-color:#24292e; }
    .auth-btns .btn.github-btn:hover { background:#2f363d; }
    .auth-or {
      text-align:center; color:var(--faint); font-size:11px; margin:6px 0;
      font-family:var(--mono); letter-spacing:.05em;
    }

    /* Presence */
    .presence-bar { display:flex; gap:4px; align-items:center; flex:none; margin-left:4px; }
    .presence-dot {
      width:22px; height:22px; border-radius:50%; border:2px solid var(--c3);
      object-fit:cover; font-size:10px; font-weight:600;
      display:grid; place-items:center; background:var(--surface-3); color:var(--text);
    }

    /* Share modal */
    .share-link-row {
      display:flex; gap:8px; align-items:center; margin:14px 0;
    }
    .share-link-row input {
      flex:1; height:36px; padding:0 12px; border:1px solid var(--border);
      border-radius:7px; background:var(--surface); font-family:var(--mono);
      font-size:12px; color:var(--text);
    }
    .share-toggle {
      display:flex; align-items:center; gap:10px; margin:12px 0;
      font-size:13px; color:var(--muted);
    }
    .share-toggle input { accent-color:var(--c3); }
    .share-status {
      font-size:11px; color:var(--faint); font-family:var(--mono);
      margin-top:4px;
    }
  `;
  document.head.appendChild(style);
}

function injectAuthUI() {
  // Auth area in top bar
  const bar = document.querySelector('.bar');
  if (bar && !document.getElementById('authArea')) {
    const area = document.createElement('div');
    area.id = 'authArea';
    area.innerHTML = `<button class="btn ghost sm" id="bLogin" style="font-size:11px;height:24px;padding:0 10px">Sign in</button>`;
    bar.appendChild(area);
  }

  // Share button (after save chip)
  const saveChip = document.getElementById('saveChip');
  if (saveChip && !document.getElementById('bShare')) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn ghost sm';
    shareBtn.id = 'bShare';
    shareBtn.hidden = true;
    shareBtn.style.cssText = 'font-size:11px;height:24px;padding:0 10px';
    shareBtn.textContent = 'Share';
    saveChip.after(shareBtn);
  }

  // Auth modal
  if (!document.getElementById('mAuth')) {
    const modal = document.createElement('div');
    modal.className = 'veil';
    modal.id = 'mAuth';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="sheet" style="width:min(420px,100%)">
        <h2>Sign in to sync your maps</h2>
        <p class="sub">Your maps stay in this browser until you sign in. Then they sync to the cloud — accessible from anywhere, shareable with others.</p>
        <div class="auth-btns">
          <button class="btn google-btn" id="authGoogle">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>
          <button class="btn github-btn" id="authGithub">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
            Continue with GitHub
          </button>
        </div>
        <div class="auth-or">Your data never leaves Supabase (Postgres)</div>
        <div class="sheet-foot"><button class="btn ghost" id="authClose">Maybe later</button></div>
      </div>
    `;
    modal.addEventListener('pointerdown', (e) => { if (e.target === modal) modal.hidden = true; });
    document.body.appendChild(modal);
  }

  // Share modal
  if (!document.getElementById('mShare')) {
    const shareModal = document.createElement('div');
    shareModal.className = 'veil';
    shareModal.id = 'mShare';
    shareModal.hidden = true;
    shareModal.innerHTML = `
      <div class="sheet" style="width:min(480px,100%)">
        <h2>Share this map</h2>
        <p class="sub">Generate a public link so others can view or collaborate on this map in real-time.</p>
        <label class="share-toggle">
          <input type="checkbox" id="sharePublicToggle" />
          <span><b style="color:var(--text)">Make this map public</b> — anyone with the link can view it</span>
        </label>
        <div class="share-link-row" id="shareLinkRow" hidden>
          <input id="shareLinkInput" readonly placeholder="Generating link..." />
          <button class="btn pri" id="copyShareLink">Copy</button>
        </div>
        <div class="share-status" id="shareStatus"></div>
        <div class="sheet-foot"><button class="btn ghost" id="shareClose">Close</button></div>
      </div>
    `;
    shareModal.addEventListener('pointerdown', (e) => { if (e.target === shareModal) shareModal.hidden = true; });
    document.body.appendChild(shareModal);
  }
}

function setupAuthModal() {
  // Auth modal handlers
  const bLogin = document.getElementById('bLogin');
  if (bLogin) bLogin.onclick = () => { document.getElementById('mAuth').hidden = false; };

  document.getElementById('authGoogle')?.addEventListener('click', signInWithGoogle);
  document.getElementById('authGithub')?.addEventListener('click', signInWithGitHub);
  document.getElementById('authClose')?.addEventListener('click', () => {
    document.getElementById('mAuth').hidden = true;
  });

  // Share modal handlers
  document.getElementById('bShare')?.addEventListener('click', async () => {
    const app = window.RecallMap;
    if (!app || !isReady()) return;

    const index = app.getIndex();
    const meta = index.maps[app.getMapId()];
    if (!meta?.cloudId) {
      document.getElementById('shareStatus').textContent = 'Save this map to cloud first (it will auto-sync).';
      document.getElementById('mShare').hidden = false;
      return;
    }

    // Load current public state
    const cloud = await loadCloudMap(meta.cloudId);
    const toggle = document.getElementById('sharePublicToggle');
    const linkRow = document.getElementById('shareLinkRow');
    const linkInput = document.getElementById('shareLinkInput');

    toggle.checked = cloud?.is_public || false;
    if (cloud?.is_public && cloud?.share_code) {
      linkRow.hidden = false;
      linkInput.value = getShareUrl(cloud.share_code);
    } else {
      linkRow.hidden = true;
    }

    document.getElementById('shareStatus').textContent = '';
    document.getElementById('mShare').hidden = false;
  });

  document.getElementById('sharePublicToggle')?.addEventListener('change', async (e) => {
    const app = window.RecallMap;
    if (!app || !isReady()) return;

    const index = app.getIndex();
    const meta = index.maps[app.getMapId()];
    if (!meta?.cloudId) return;

    const linkRow = document.getElementById('shareLinkRow');
    const linkInput = document.getElementById('shareLinkInput');
    const status = document.getElementById('shareStatus');

    const shareCode = await togglePublic(meta.cloudId, e.target.checked);
    if (shareCode && e.target.checked) {
      linkRow.hidden = false;
      linkInput.value = getShareUrl(shareCode);
      meta.isPublic = true;
      meta.cloudShareCode = shareCode;
      status.textContent = 'Anyone with this link can view your map in real-time.';
    } else {
      linkRow.hidden = true;
      meta.isPublic = false;
      status.textContent = e.target.checked ? 'Failed to generate link.' : 'Map is now private.';
    }
    app.saveIndex();
  });

  document.getElementById('copyShareLink')?.addEventListener('click', async () => {
    const input = document.getElementById('shareLinkInput');
    try {
      await navigator.clipboard.writeText(input.value);
      document.getElementById('shareStatus').textContent = 'Link copied!';
    } catch (e) {
      input.select();
      document.getElementById('shareStatus').textContent = 'Select and copy manually.';
    }
  });

  document.getElementById('shareClose')?.addEventListener('click', () => {
    document.getElementById('mShare').hidden = true;
  });
}

// ── Export for use by main app ──────────────────────────────

window.Cloud = {
  isReady,
  signInWithGoogle,
  signInWithGitHub,
  signOut,
  loadCloudMaps,
  loadSharedMaps,
  saveCloudMap,
  createCloudMap,
  deleteCloudMap,
  cloudSave,
  cloudLoad,
  subscribeToMap,
  unsubscribeRealtime,
  togglePublic,
  getShareUrl,
  refreshCloudMaps,
  get currentUser() { return currentUser; },
};

// ── Auto-boot when DOM is ready ────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 100));
} else {
  setTimeout(boot, 100);
}

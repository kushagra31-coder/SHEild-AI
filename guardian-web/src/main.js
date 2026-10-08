import { createClient } from '@supabase/supabase-js';
import './style.css';

const app = document.querySelector('#app');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '');
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
let viewId = 0;
let activeSession = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

async function getApi(path, session, method = 'GET') {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${(activeSession || session).access_token}` },
  });
  let body = {};
  try { body = await response.json(); } catch { /* Keep the HTTP error below. */ }
  if (!response.ok) {
    const error = new Error(body.detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function showLogin(error = '') {
  viewId += 1;
  app.innerHTML = `
    <section class="login-card">
      <p class="eyebrow">SHEild AI</p>
      <h1>Guardian sign in</h1>
      <p class="muted">Sign in with the guardian account linked to an incident owner.</p>
      ${!supabase ? '<p class="message error">Set the Supabase and API values in <code>.env.local</code>, then restart this app.</p>' : ''}
      <form id="login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="primary" type="submit" ${supabase ? '' : 'disabled'}>Sign in</button>
      </form>
      <p id="login-error" class="message error" role="alert">${escapeHtml(error)}</p>
    </section>`;

  app.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = 'Signing in…';
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: form.get('email'),
      password: form.get('password'),
    });
    if (authError) {
      showLogin(authError.message);
      return;
    }
  });
}

function showDashboard(session) {
  const currentView = ++viewId;
  app.innerHTML = `
    <section class="dashboard">
      <header class="topbar">
        <div><p class="eyebrow">SHEild AI</p><h1>Guardian incidents</h1></div>
        <div class="account"><span>${escapeHtml(session.user.email)}</span><button id="logout" class="secondary">Log out</button></div>
      </header>
      <section class="panel">
        <div class="list-heading"><div><h2>Active and acknowledged</h2><p class="muted">Recent incidents available to your account</p></div><button id="refresh" class="secondary">Refresh</button></div>
        <p id="list-state" class="muted" role="status">Loading incidents…</p>
        <div id="incident-list" class="incident-list"></div>
      </section>
    </section>`;

  app.querySelector('#logout').addEventListener('click', async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) showDashboardError(signOutError.message);
  });
  app.querySelector('#refresh').addEventListener('click', () => loadIncidents(session, currentView));
  loadIncidents(session, currentView);
}

function showDashboardError(message) {
  const state = app.querySelector('#list-state');
  if (state) {
    state.className = 'message error';
    state.textContent = message;
  }
}

async function loadIncidents(session, currentView) {
  const state = app.querySelector('#list-state');
  const list = app.querySelector('#incident-list');
  if (!state || !list) return;
  state.className = 'muted';
  state.textContent = 'Loading incidents…';
  list.replaceChildren();

  try {
    const body = await getApi('/incidents', session);
    if (currentView !== viewId) return;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      state.textContent = 'No active incidents are currently available to this account.';
      return;
    }
    state.textContent = `${body.items.length} incident${body.items.length === 1 ? '' : 's'}`;
    list.innerHTML = body.items.map((incident) => `
      <button class="incident-card" type="button" data-incident-id="${escapeHtml(incident.id)}" aria-label="Open incident ${escapeHtml(incident.id)}">
        <div class="incident-heading"><span class="status status-${escapeHtml(incident.status)}">${escapeHtml(incident.status)}</span><span class="trigger">${escapeHtml(incident.trigger)}</span></div>
        <dl>
          <div><dt>Incident ID</dt><dd class="id">${escapeHtml(incident.id)}</dd></div>
          <div><dt>Started</dt><dd>${escapeHtml(formatDate(incident.started_at))}</dd></div>
          <div><dt>Location sharing</dt><dd>${incident.share_location === true ? 'On' : incident.share_location === false ? 'Off' : 'Unavailable from API'}</dd></div>
        </dl>
      </button>`).join('');
    list.querySelectorAll('[data-incident-id]').forEach((card) => {
      card.addEventListener('click', () => showIncidentDetail(session, card.dataset.incidentId));
    });
  } catch (error) {
    if (currentView !== viewId) return;
    state.className = 'message error';
    state.textContent = error instanceof Error ? error.message : 'Could not load incidents.';
  }
}

function showIncidentDetail(session, incidentId) {
  const currentView = ++viewId;
  app.innerHTML = `
    <section class="dashboard">
      <header class="topbar">
        <div><p class="eyebrow">SHEild AI</p><h1>Incident details</h1></div>
        <div class="account"><span>${escapeHtml(session.user.email)}</span><button id="logout" class="secondary">Log out</button></div>
      </header>
      <button id="back" class="secondary back-button" type="button">← Back to dashboard</button>
      <section class="panel detail-panel">
        <p id="detail-state" class="muted" role="status">Loading incident details…</p>
        <div id="incident-detail"></div>
      </section>
    </section>`;

  app.querySelector('#back').addEventListener('click', () => showDashboard(session));
  app.querySelector('#logout').addEventListener('click', async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) showDetailError(signOutError.message, currentView);
  });
  loadIncidentDetail(session, incidentId, currentView);
}

function showDetailError(message, currentView) {
  if (currentView !== viewId) return;
  const state = app.querySelector('#detail-state');
  if (state) {
    state.className = 'message error';
    state.textContent = message;
  }
}

async function loadIncidentDetail(session, incidentId, currentView, successMessage = '') {
  try {
    const detail = await getApi(`/incidents/${encodeURIComponent(incidentId)}`, session);
    if (currentView !== viewId) return;
    let location = null;
    if (detail.share_location) {
      try {
        location = await getApi(`/incidents/${encodeURIComponent(incidentId)}/location`, session);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    if (currentView !== viewId) return;

    const acknowledgements = detail.acknowledgements || [];
    // These checks only control which buttons are shown; FastAPI remains authoritative.
    const isOwner = detail.owner_id === session.user.id;
    const canAcknowledge = detail.status === 'active' && !isOwner;
    const canResolve = isOwner && ['active', 'acknowledged'].includes(detail.status);
    app.querySelector('#detail-state').textContent = '';
    app.querySelector('#incident-detail').innerHTML = `
      <div class="incident-heading"><span class="status status-${escapeHtml(detail.status)}">${escapeHtml(detail.status)}</span><span class="trigger">${escapeHtml(detail.trigger)}</span></div>
      <dl class="detail-grid">
        <div><dt>Incident ID</dt><dd class="id">${escapeHtml(detail.id)}</dd></div>
        <div><dt>Started</dt><dd>${escapeHtml(formatDate(detail.started_at))}</dd></div>
        <div><dt>Resolved</dt><dd>${escapeHtml(formatDate(detail.resolved_at))}</dd></div>
        <div><dt>Location sharing</dt><dd>${detail.share_location ? 'On' : 'Off'}</dd></div>
      </dl>
      <div class="action-row">
        ${canAcknowledge ? '<button class="primary action-button" type="button" data-action="acknowledge">Acknowledge</button>' : ''}
        ${canResolve ? '<button class="secondary action-button" type="button" data-action="resolve">Resolve</button>' : ''}
      </div>
      <p id="action-state" class="message ${successMessage ? 'success' : ''}" role="status">${escapeHtml(successMessage)}</p>
      <section class="detail-section"><h2>Latest location</h2>
        ${!detail.share_location
          ? '<p class="muted">Location sharing is off for this incident.</p>'
          : location
            ? `<div class="location-box"><p><strong>Latitude:</strong> ${escapeHtml(location.latitude)}</p><p><strong>Longitude:</strong> ${escapeHtml(location.longitude)}</p><p><strong>Captured:</strong> ${escapeHtml(formatDate(location.captured_at))}</p>${location.accuracy_m == null ? '' : `<p><strong>Accuracy:</strong> ${escapeHtml(location.accuracy_m)} m</p>`}</div>`
            : '<p class="muted">No location has been reported for this incident.</p>'}
      </section>
      <section class="detail-section"><h2>Acknowledgements</h2>
        ${acknowledgements.length
          ? `<ul class="ack-list">${acknowledgements.map((ack) => `<li><strong>${escapeHtml(formatDate(ack.acknowledged_at))}</strong>${ack.note ? `<span>${escapeHtml(ack.note)}</span>` : ''}<small>Guardian ${escapeHtml(ack.guardian_id)}</small></li>`).join('')}</ul>`
          : '<p class="muted">No acknowledgement has been recorded.</p>'}
      </section>`;

    app.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => performIncidentAction(session, incidentId, button.dataset.action, currentView));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load incident details.';
    if (successMessage) showActionMessage(`Action succeeded, but refreshing the incident failed: ${message}`, true, currentView);
    else showDetailError(message, currentView);
  }
}

async function performIncidentAction(session, incidentId, action, currentView) {
  const buttons = app.querySelectorAll('[data-action]');
  buttons.forEach((button) => { button.disabled = true; });
  showActionMessage(action === 'acknowledge' ? 'Submitting acknowledgement…' : 'Resolving incident…', false, currentView);
  try {
    await getApi(`/incidents/${encodeURIComponent(incidentId)}/${action}`, session, 'POST');
    if (currentView !== viewId) return;
    const successMessage = action === 'acknowledge' ? 'Incident acknowledged.' : 'Incident resolved.';
    await loadIncidentDetail(session, incidentId, currentView, successMessage);
  } catch (error) {
    showActionMessage(error instanceof Error ? error.message : 'The action could not be completed.', true, currentView);
    app.querySelectorAll('[data-action]').forEach((button) => { button.disabled = false; });
  }
}

function showActionMessage(message, isError, currentView) {
  if (currentView !== viewId) return;
  const state = app.querySelector('#action-state');
  if (state) {
    state.className = `message ${isError ? 'error' : 'success'}`;
    state.setAttribute('role', isError ? 'alert' : 'status');
    state.textContent = message;
  }
}

if (!supabase) showLogin();
else {
  supabase.auth.onAuthStateChange((event, session) => {
    activeSession = session;
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      if (session) showDashboard(session);
      else showLogin();
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });
}

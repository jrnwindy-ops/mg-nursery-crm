// M&G Nursery CRM — Service Worker
// Handles background sync and push notifications

const CACHE_NAME = 'mg-nursery-v1';
const CHECK_INTERVAL = 60 * 60 * 1000; // check every hour

// ── Install & Activate ────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── Periodic background check ─────────────────────────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'mg-daily-check') {
    e.waitUntil(runDailyCheck());
  }
});

// ── Message from CRM page (manual trigger) ────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_REMINDERS') {
    runDailyCheck(e.data.payload);
  }
  if (e.data && e.data.type === 'SCHEDULE_CHECK') {
    scheduleNextCheck(e.data.payload);
  }
});

// ── Push notification (from server) ───────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch(err) { return; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'M&G Nursery', {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'mg-nursery',
      data: data.url || '/',
      requireInteraction: data.urgent || false,
      actions: data.actions || []
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('mgnurserycrm') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Core check logic ──────────────────────────────────────────────────────────
async function runDailyCheck(payload) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const hour = now.getHours();

  // Only notify between 7am and 8pm
  if (hour < 7 || hour > 20) return;

  // Use payload from page if provided, otherwise skip (no DB access from SW)
  if (!payload) return;

  const { contacts = [], reminders = [], followups = [] } = payload;
  const notifications = [];

  // Overdue follow-ups
  const overdueFollowups = followups.filter(f => f.date < today && !f.done);
  if (overdueFollowups.length > 0) {
    notifications.push({
      title: `⚠️ ${overdueFollowups.length} overdue follow-up${overdueFollowups.length > 1 ? 's' : ''}`,
      body: overdueFollowups.slice(0, 3).map(f => f.name).join(', '),
      tag: 'mg-followups',
      urgent: true
    });
  }

  // Reminders due today
  const todayReminders = reminders.filter(r => r.date === today && !r.done);
  if (todayReminders.length > 0) {
    notifications.push({
      title: `🔔 ${todayReminders.length} reminder${todayReminders.length > 1 ? 's' : ''} due today`,
      body: todayReminders.slice(0, 3).map(r => r.note).join(' · '),
      tag: 'mg-reminders',
      urgent: false
    });
  }

  // Upcoming deliveries in next 7 days
  const soon = new Date(); soon.setDate(soon.getDate() + 7);
  const soonISO = soon.toISOString().split('T')[0];
  const upcoming = contacts.filter(c => c.date && c.date >= today && c.date <= soonISO);
  if (upcoming.length > 0) {
    notifications.push({
      title: `🌱 ${upcoming.length} delivery${upcoming.length > 1 ? ' dates' : ''} in next 7 days`,
      body: upcoming.slice(0, 3).map(c => c.name).join(', '),
      tag: 'mg-deliveries',
      urgent: false
    });
  }

  // Fire notifications
  for (const n of notifications) {
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: n.tag,
      requireInteraction: n.urgent,
      data: 'https://mgnurserycrm.netlify.app'
    });
  }
}

function scheduleNextCheck(payload) {
  // Store payload in cache for next periodic check
  caches.open(CACHE_NAME).then(cache => {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    cache.put('/mg-check-payload', new Response(blob));
  });
}

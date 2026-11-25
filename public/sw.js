const cacheName='linkora-shell-1';
self.addEventListener('install',e=>e.waitUntil(caches.open(cacheName).then(c=>c.addAll(['/offline.html','/assets/logo.svg']))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')))}else if(u.pathname==='/assets/logo.svg')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});

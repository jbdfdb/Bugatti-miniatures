/* ═══════════════════════════════════════════════════════════
   Les Bugatti de Pascal — Module administrateur
   Connexion, édition, CSV, dashboard. Se greffe sur window.App.
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const STATE = { admin: false, csrf: null, passwordSet: true };

    // ═══ Client API (ajoute le jeton CSRF, gère les erreurs) ═══
    async function api(method, url, body, isForm) {
        const opts = { method, headers: {}, credentials: 'same-origin' };
        if (STATE.csrf) opts.headers['X-CSRF-Token'] = STATE.csrf;
        if (body !== undefined) {
            if (isForm) { opts.body = body; }
            else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        }
        let resp;
        try {
            resp = await fetch(url, opts);
        } catch (e) {
            throw new Error('Impossible de joindre le serveur. Le site est-il bien lancé (bugatti run) ?');
        }
        let data = {};
        try { data = await resp.json(); } catch (e) { /* réponse vide */ }
        // Un 404 SANS message applicatif = la route n'existe pas → serveur
        // périmé. Un 404 AVEC message (« Miniature introuvable », « Texte
        // inconnu ») est une vraie réponse métier : on affiche son message.
        if (resp.status === 404 && (!data.detail || data.detail === 'Not Found')) {
            throw new Error('Serveur non à jour : arrêtez-le (Ctrl+C) et relancez « bugatti run ».');
        }
        if (!resp.ok) throw new Error(data.detail || `Erreur ${resp.status}`);
        return data;
    }

    // ═══ Session ═══
    async function checkSession() {
        try {
            const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
            STATE.admin = s.admin;
            STATE.csrf = s.csrf;
            STATE.passwordSet = s.password_set;
        } catch (e) { /* hors ligne */ }
        applyAdminUI();
    }

    function applyAdminUI() {
        const enter = document.getElementById('admin-enter');
        const tools = document.getElementById('admin-tools');
        enter.classList.toggle('hidden', STATE.admin);
        tools.classList.toggle('hidden', !STATE.admin);
        if (window.App) window.App.setAdminMode(STATE.admin);
    }

    // ═══ Connexion / première configuration ═══
    async function openLogin() {
        const modal = document.getElementById('login-modal');
        const title = document.getElementById('login-title');
        const hint = document.getElementById('login-hint');
        const pw2 = document.getElementById('login-password2');
        const submit = document.getElementById('login-submit');
        document.getElementById('login-error').textContent = '';
        document.getElementById('login-form').reset();

        // Rafraîchit l'état pour ouvrir le bon mode même si la session
        // n'était pas encore chargée au moment du clic (évite tout décalage).
        try {
            const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
            STATE.passwordSet = s.password_set; STATE.admin = s.admin; STATE.csrf = s.csrf;
        } catch (e) {
            document.getElementById('login-error').textContent =
                'Impossible de joindre le serveur. Le site est-il bien lancé (bugatti run) ?';
        }

        if (!STATE.passwordSet) {
            title.textContent = 'Créer le mot de passe admin';
            hint.textContent = 'Premier lancement : choisissez le mot de passe (au moins 6 caractères) qui protègera l\'édition du site. Notez-le précieusement.';
            pw2.classList.remove('hidden');
            pw2.setAttribute('required', '');
            submit.textContent = 'Créer le mot de passe';
        } else {
            title.textContent = 'Connexion administrateur';
            hint.textContent = 'Saisissez le mot de passe pour activer l\'édition.';
            pw2.classList.add('hidden');
            pw2.removeAttribute('required');
            submit.textContent = 'Se connecter';
        }
        modal.classList.add('active');
        setTimeout(() => document.getElementById('login-password').focus(), 40);
    }
    function closeLogin() { document.getElementById('login-modal').classList.remove('active'); }

    async function submitLogin(e) {
        e.preventDefault();
        const err = document.getElementById('login-error');
        err.textContent = '';
        const pw = document.getElementById('login-password').value;
        if (!pw) { err.textContent = 'Entrez un mot de passe.'; return; }
        try {
            let res;
            if (!STATE.passwordSet) {
                const pw2 = document.getElementById('login-password2').value;
                if (pw.length < 6) { err.textContent = 'Le mot de passe doit contenir au moins 6 caractères.'; return; }
                if (pw !== pw2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
                res = await api('POST', '/api/admin/setup', { password: pw });
            } else {
                res = await api('POST', '/api/admin/login', { password: pw });
            }
            STATE.admin = true; STATE.csrf = res.csrf; STATE.passwordSet = true;
            closeLogin(); applyAdminUI();
            window.App.toast('Mode admin activé', 'ok');
        } catch (ex) { err.textContent = ex.message; }
    }

    async function exitAdmin() {
        try { await api('POST', '/api/admin/logout'); } catch (e) { /* ignore */ }
        STATE.admin = false; STATE.csrf = null;
        applyAdminUI();
        window.App.toast('Retour au site public', 'ok');
    }

    // ═══ Panneau (onglets) ═══
    function openPanel() {
        document.getElementById('admin-panel').classList.add('active');
        renderGuide();
    }
    function closePanel() { document.getElementById('admin-panel').classList.remove('active'); }

    function switchTab(tab) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.admin-tabpane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
        if (tab === 'traffic') renderTraffic();
        if (tab === 'settings') loadSettings();
    }

    // ═══ CSV ═══
    async function importCsv() {
        const input = document.getElementById('csv-file');
        const result = document.getElementById('csv-result');
        if (!input.files[0]) { result.textContent = 'Choisissez d\'abord un fichier CSV.'; return; }
        if (!confirm('Cet import va REMPLACER toute la collection. Une sauvegarde de la version actuelle sera créée. Continuer ?')) return;
        result.textContent = 'Import en cours…';
        const fd = new FormData();
        fd.append('file', input.files[0]);
        try {
            const res = await api('POST', '/api/admin/import-csv', fd, true);
            result.innerHTML = `<span class="ok">✔ ${res.imported} miniatures importées (${res.created} ajoutées, ${res.updated} mises à jour). Rechargement…</span>`;
            // Rechargement complet : l'import change toute la collection, donc
            // aussi les filtres, les graphes, la timeline et les compteurs.
            setTimeout(() => window.location.reload(), 1400);
        } catch (ex) {
            result.innerHTML = `<span class="err">✖ ${ex.message}</span>`;
        }
    }

    // ═══ Dashboard fréquentation ═══
    let trafficChart = null;
    async function renderTraffic() {
        const box = document.getElementById('traffic-content');
        box.innerHTML = '<p class="admin-hint">Chargement…</p>';
        let d;
        try { d = await api('GET', '/api/admin/analytics'); }
        catch (ex) { box.innerHTML = `<p class="admin-error">${ex.message}</p>`; return; }

        const topPaths = d.top_paths.map(([p, c]) => `<li><code>${p}</code> — ${c}</li>`).join('') || '<li>Aucune donnée</li>';
        box.innerHTML = `
            <div class="traffic-tiles">
                <div class="traffic-tile"><span class="tt-num">${d.window_visits.toLocaleString('fr-FR')}</span><span class="tt-lbl">visites (${d.window_days} j)</span></div>
                <div class="traffic-tile"><span class="tt-num">${d.window_unique.toLocaleString('fr-FR')}</span><span class="tt-lbl">visiteurs uniques (${d.window_days} j)</span></div>
                <div class="traffic-tile"><span class="tt-num">${d.total_visits.toLocaleString('fr-FR')}</span><span class="tt-lbl">visites au total</span></div>
                <div class="traffic-tile"><span class="tt-num">${d.unique_visitors.toLocaleString('fr-FR')}</span><span class="tt-lbl">visiteurs uniques (total)</span></div>
            </div>
            <div class="traffic-chart-wrap"><canvas id="traffic-chart"></canvas></div>
            <h3>Pages les plus vues</h3>
            <ul class="traffic-paths">${topPaths}</ul>
            <p class="admin-hint">IP exclues du comptage : ${(d.excluded_ips || []).join(', ') || 'aucune'} — modifiable dans l'onglet Réglages.</p>`;

        if (typeof Chart !== 'undefined') {
            if (trafficChart) trafficChart.destroy();
            trafficChart = new Chart(document.getElementById('traffic-chart'), {
                type: 'bar',
                data: {
                    labels: d.series.map(p => p.date.slice(5)),
                    datasets: [{ label: 'Visites / jour', data: d.series.map(p => p.count),
                        backgroundColor: 'rgba(201, 168, 76, 0.7)', borderRadius: 3, borderSkipped: false }]
                },
                options: { responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', maxTicksLimit: 12 } },
                        y: { beginAtZero: true, ticks: { color: 'rgba(255,255,255,0.6)', precision: 0 } } } }
            });
        }
    }

    // ═══ Réglages ═══
    async function loadSettings() {
        try {
            const ip = await api('GET', '/api/admin/my-ip');
            document.getElementById('my-ip').textContent = ip.ip || '—';
            document.getElementById('my-ip').dataset.ip = ip.ip || '';
        } catch (e) { /* ignore */ }
        try {
            const ex = await api('GET', '/api/admin/excluded');
            document.getElementById('excluded-ips').value = (ex.ips || []).join('\n');
        } catch (e) { /* ignore */ }
    }
    async function changePassword(e) {
        e.preventDefault();
        const res = document.getElementById('pw-result');
        res.textContent = '';
        try {
            await api('POST', '/api/admin/change-password', {
                current: document.getElementById('pw-current').value,
                new: document.getElementById('pw-new').value,
            });
            res.innerHTML = '<span class="ok">✔ Mot de passe mis à jour.</span>';
            document.getElementById('pw-form').reset();
        } catch (ex) { res.innerHTML = `<span class="err">✖ ${ex.message}</span>`; }
    }
    async function saveIps() {
        const res = document.getElementById('ips-result');
        const ips = document.getElementById('excluded-ips').value.split('\n').map(s => s.trim()).filter(Boolean);
        try {
            const out = await api('POST', '/api/admin/excluded', { ips });
            document.getElementById('excluded-ips').value = out.ips.join('\n');
            res.innerHTML = '<span class="ok">✔ Exclusions enregistrées.</span>';
        } catch (ex) { res.innerHTML = `<span class="err">✖ ${ex.message}</span>`; }
    }

    // ═══ Guide administrateur ═══
    function renderGuide() {
        const pane = document.getElementById('pane-guide');
        if (pane.dataset.filled === '1') return;
        pane.dataset.filled = '1';
        pane.innerHTML = `
            <h3>Bienvenue dans votre espace d'administration 🏎️</h3>
            <p class="admin-hint">Vous seul voyez ces outils : les visiteurs du site restent en lecture seule.</p>
            <ol class="guide-list">
                <li><strong>Modifier un texte ou une fiche</strong> — un petit crayon ✎ apparaît à côté de chaque texte modifiable (titres, sous-titres, et chaque champ d'une miniature). Cliquez dessus, corrigez, puis <em>Enregistrer</em>. C'est instantané.</li>
                <li><strong>Ajouter une miniature</strong> — bouton <strong>« + Miniature »</strong> en bas de l'écran. Une fiche vierge s'ouvre : remplissez les champs au crayon.</li>
                <li><strong>Supprimer une miniature</strong> — ouvrez sa fiche, bouton <em>« Supprimer cette miniature »</em> en bas.</li>
                <li><strong>Photos</strong> — dans une fiche, <em>« Ajouter / Remplacer la photo »</em> (JPG, PNG ou WebP, jusqu'à 15 Mo). Sans photo propre, le site affiche automatiquement une photo du type de Bugatti.</li>
                <li><strong>Modifier en masse (CSV)</strong> — onglet <strong>Base de données</strong> : <em>téléchargez</em> le CSV, modifiez-le tranquillement dans Excel/Numbers <u>sans changer les en-têtes</u>, puis <em>réimportez-le</em>. Une sauvegarde est faite avant chaque import.</li>
                <li><strong>Fréquentation</strong> — onglet <strong>Fréquentation</strong> : nombre de visites et de visiteurs. Votre IP et celle de J-B sont exclues (onglet Réglages pour en ajouter).</li>
                <li><strong>Mot de passe</strong> — onglet <strong>Réglages</strong>. En cas d'oubli, contactez J-B : il peut le réinitialiser à distance.</li>
                <li><strong>Revenir au site public</strong> — bouton <strong>« Site public »</strong> : masque tous les crayons (aucun mot de passe pour ressortir).</li>
            </ol>
            <p class="admin-hint">💡 Vos modifications sont enregistrées sur votre ordinateur. Pensez à faire une sauvegarde de temps en temps : dans le Terminal, tapez <code>bugatti backup</code>.</p>`;
    }

    // ═══ API exposée à app.js ═══
    window.Admin = {
        isAdmin: () => STATE.admin,
        onDataReady() { /* le rendu admin est déjà appliqué via applyAdminUI */ },
        async saveContent(key, value) { await api('PATCH', '/api/admin/content', { key, value }); },
        async saveMiniatureField(id, field, value) {
            const res = await api('PATCH', `/api/admin/miniature/${id}`, { field, value });
            return res.miniature;
        },
        async uploadPhoto(id, file) {
            const fd = new FormData();
            fd.append('miniature_id', id);
            fd.append('photo', file);
            const res = await api('POST', '/api/admin/upload-photo', fd, true);
            return res.url;
        },
        async deletePhoto(id) { await api('DELETE', `/api/admin/photo/${id}`); },
        async deleteMiniature(id) {
            if (!confirm('Supprimer définitivement cette miniature ?')) return;
            try {
                await api('DELETE', `/api/admin/miniature/${id}`);
                document.getElementById('detail-modal').classList.remove('active');
                document.body.style.overflow = '';
                await window.App.reload();
                window.App.toast('Miniature supprimée', 'ok');
            } catch (ex) { window.App.toast(ex.message, 'err'); }
        },
        async addMiniature() {
            try {
                const res = await api('POST', '/api/admin/miniature');
                await window.App.reload();
                window.App.openModal(res.miniature.id);
                window.App.toast('Nouvelle miniature créée — remplissez ses champs', 'ok');
            } catch (ex) { window.App.toast(ex.message, 'err'); }
        },
    };

    // ═══ Câblage ═══
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('admin-enter').addEventListener('click', openLogin);
        document.getElementById('admin-exit').addEventListener('click', exitAdmin);
        document.getElementById('admin-panel-open').addEventListener('click', openPanel);
        document.getElementById('admin-add').addEventListener('click', () => window.Admin.addMiniature());
        document.getElementById('login-form').addEventListener('submit', submitLogin);
        document.querySelector('[data-close-login]').addEventListener('click', closeLogin);
        document.querySelector('#login-modal .admin-modal-backdrop').addEventListener('click', closeLogin);
        document.querySelector('[data-close-panel]').addEventListener('click', closePanel);
        document.querySelector('#admin-panel .admin-modal-backdrop').addEventListener('click', closePanel);
        document.querySelectorAll('.admin-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
        document.getElementById('csv-import-btn').addEventListener('click', importCsv);
        document.getElementById('csv-file').addEventListener('change', (e) => {
            document.getElementById('csv-file-name').textContent =
                e.target.files[0] ? e.target.files[0].name : 'Aucun fichier sélectionné';
        });
        document.getElementById('pw-form').addEventListener('submit', changePassword);
        document.getElementById('save-ips').addEventListener('click', saveIps);
        document.getElementById('add-my-ip').addEventListener('click', () => {
            const ip = document.getElementById('my-ip').dataset.ip;
            const ta = document.getElementById('excluded-ips');
            const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
            if (ip && !lines.includes(ip)) { lines.push(ip); ta.value = lines.join('\n'); }
        });
        checkSession();
    });
})();

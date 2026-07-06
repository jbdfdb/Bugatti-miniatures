/* ═══════════════════════════════════════════════════════════
   Les Bugatti de Pascal — Application front (site public)
   Le module admin (admin.js) se greffe via window.App / window.Admin.
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ═══ STATE ═══
    let DATA = null;
    let CONTENT = {};
    let PHOTOS = { miniature_photos: {}, type_photos: {} };
    let filtered = [];
    let currentPage = 1;
    const PAGE_SIZE = 48;
    let currentView = 'grid';
    let sortColumn = null;
    let sortAsc = true;
    let activeFilters = {
        search: '', echelle: 'all', material: 'all',
        marque: 'all', type: 'all', fabricant: 'all',
    };
    // Filtre perso admin : n'afficher que la collection de Pascal (source_info = pvm).
    let showMineOnly = false;
    const MY_COLLECTION = 'pvm';   // valeur de source_info identifiant la collection de Pascal

    const isAdmin = () => window.Admin && window.Admin.isAdmin();

    // ═══ HERO CANVAS — Particle System ═══
    function initHeroCanvas() {
        const canvas = document.getElementById('hero-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let w, h, particles;

        function resize() {
            w = canvas.width = canvas.offsetWidth;
            h = canvas.height = canvas.offsetHeight;
        }
        class Particle {
            constructor() { this.reset(); }
            reset() {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.3;
                this.speedY = (Math.random() - 0.5) * 0.3;
                this.opacity = Math.random() * 0.5 + 0.1;
                this.color = Math.random() > 0.7
                    ? `rgba(201, 168, 76, ${this.opacity})`
                    : `rgba(100, 140, 220, ${this.opacity * 0.5})`;
            }
            update() {
                this.x += this.speedX; this.y += this.speedY;
                if (this.x < 0 || this.x > w || this.y < 0 || this.y > h) this.reset();
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color; ctx.fill();
            }
        }
        function init() {
            resize();
            const count = Math.min(Math.floor((w * h) / 8000), 200);
            particles = Array.from({ length: count }, () => new Particle());
        }
        function drawLines() {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(201, 168, 76, ${0.06 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5; ctx.stroke();
                    }
                }
            }
        }
        function animate() {
            ctx.clearRect(0, 0, w, h);
            particles.forEach(p => { p.update(); p.draw(); });
            drawLines();
            requestAnimationFrame(animate);
        }
        window.addEventListener('resize', resize);
        init(); animate();
    }

    // ═══ COUNTER ANIMATION ═══
    function animateCounters() {
        document.querySelectorAll('[data-count]').forEach(el => {
            const target = parseInt(el.dataset.count) || 0;
            const duration = 2000;
            const start = performance.now();
            function tick(now) {
                const progress = Math.min((now - start) / duration, 1);
                const ease = 1 - Math.pow(1 - progress, 3);
                el.textContent = Math.floor(target * ease).toLocaleString('fr-FR');
                if (progress < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        });
    }

    // ═══ NAVIGATION ═══
    function initNav() {
        const nav = document.getElementById('main-nav');
        window.addEventListener('scroll', () => {
            const y = window.scrollY;
            nav.classList.toggle('visible', y > 300);
            document.querySelectorAll('[data-nav]').forEach(link => {
                const target = document.querySelector(link.getAttribute('href'));
                if (target) {
                    const rect = target.getBoundingClientRect();
                    if (rect.top <= 150 && rect.bottom >= 150) {
                        document.querySelectorAll('[data-nav]').forEach(l => l.classList.remove('active'));
                        link.classList.add('active');
                    }
                }
            });
        });
        document.getElementById('nav-search').addEventListener('input', e => {
            document.getElementById('search-input').value = e.target.value;
            activeFilters.search = e.target.value.toLowerCase();
            currentPage = 1;
            applyFilters();
            if (e.target.value.length > 0) {
                document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // ═══ SCROLL REVEAL ═══
    function initScrollReveal() {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
        document.querySelectorAll('.section-header, .stat-card, .timeline-era').forEach(el => {
            el.classList.add('fade-in'); observer.observe(el);
        });
    }

    // ═══ TEXTES ÉDITORIAUX (data-content) ═══
    function applyContent() {
        document.querySelectorAll('[data-content]').forEach(el => {
            const key = el.dataset.content;
            if (CONTENT[key] !== undefined) el.textContent = CONTENT[key];
            ensurePencil(el, () => {
                openEditor({
                    label: 'Modifier le texte',
                    value: CONTENT[key] || '',
                    multiline: (CONTENT[key] || '').length > 40,
                    onSave: async (val) => {
                        await window.Admin.saveContent(key, val);
                        CONTENT[key] = val;
                        el.textContent = val;
                    },
                });
            });
        });
        const footer = document.getElementById('footer-stats');
        if (footer && DATA) {
            footer.textContent =
                `${DATA.stats.total.toLocaleString('fr-FR')} miniatures référencées · ` +
                `${DATA.stats.fabricants.toLocaleString('fr-FR')} fabricants · ` +
                `${DATA.stats.types.toLocaleString('fr-FR')} types Bugatti`;
        }
    }

    /** Ajoute (une seule fois) un crayon d'édition à côté d'un élément. */
    function ensurePencil(el, onClick) {
        if (el.dataset.pencil === '1') return;
        el.dataset.pencil = '1';
        const btn = document.createElement('button');
        btn.className = 'edit-pencil';
        btn.title = 'Modifier';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onClick(); });
        el.insertAdjacentElement('afterend', btn);
    }

    // ═══ ÉDITEUR INLINE (popover réutilisable) ═══
    function openEditor({ label, value, multiline, onSave }) {
        let pop = document.getElementById('edit-popover');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'edit-popover';
            pop.className = 'admin-modal';
            pop.innerHTML = `
                <div class="admin-modal-backdrop"></div>
                <div class="admin-modal-box admin-modal-small">
                    <button class="admin-modal-close" id="ep-close">&times;</button>
                    <h3 id="ep-label"></h3>
                    <div id="ep-field"></div>
                    <div id="ep-error" class="admin-error"></div>
                    <div class="ep-actions">
                        <button class="admin-btn" id="ep-cancel">Annuler</button>
                        <button class="admin-primary" id="ep-save">Enregistrer</button>
                    </div>
                </div>`;
            document.body.appendChild(pop);
        }
        pop.querySelector('#ep-label').textContent = label;
        const fieldWrap = pop.querySelector('#ep-field');
        fieldWrap.innerHTML = multiline
            ? `<textarea id="ep-input" rows="4"></textarea>`
            : `<input type="text" id="ep-input">`;
        const input = pop.querySelector('#ep-input');
        input.value = value;
        const errBox = pop.querySelector('#ep-error');
        errBox.textContent = '';
        pop.classList.add('active');
        setTimeout(() => input.focus(), 30);

        const close = () => pop.classList.remove('active');
        pop.querySelector('#ep-close').onclick = close;
        pop.querySelector('#ep-cancel').onclick = close;
        pop.querySelector('.admin-modal-backdrop').onclick = close;
        const save = async () => {
            errBox.textContent = '';
            try {
                await onSave(input.value.trim());
                close();
                App.toast('Modification enregistrée', 'ok');
            } catch (err) {
                errBox.textContent = err.message || 'Erreur.';
            }
        };
        pop.querySelector('#ep-save').onclick = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !multiline) { e.preventDefault(); save(); }
            if (e.key === 'Escape') close();
        };
    }

    // ═══ PHOTO HELPERS ═══
    function getPhotoUrl(m) {
        const uploaded = PHOTOS.miniature_photos[String(m.id)];
        if (uploaded) return uploaded.url;
        const typePhoto = PHOTOS.type_photos[m.type_number];
        if (typePhoto) return typePhoto.url;
        const tb = (m.type_bugatti || '').toLowerCase();
        const modernMap = {
            'veyron': 'veyron', 'chiron': 'chiron', 'divo': 'divo',
            'bolide': 'bolide', 'voiture noire': 'la_voiture_noire',
            'eb110': '110', 'eb 110': '110',
        };
        for (const [kw, key] of Object.entries(modernMap)) {
            if (tb.includes(kw) && PHOTOS.type_photos[key]) return PHOTOS.type_photos[key].url;
        }
        return null;
    }

    function photoHtml(m, size) {
        const url = getPhotoUrl(m);
        if (!url) {
            return `<div class="card-photo card-photo-placeholder ${size || ''}">
                <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 38 C15 38 18 25 30 22 C38 20 42 18 55 18 C65 18 75 16 85 18 C95 20 100 24 105 30 C107 33 108 36 108 38 Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                    <circle cx="32" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                    <circle cx="92" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                </svg></div>`;
        }
        return `<div class="card-photo ${size || ''}" style="background-image:url('${cssUrl(url)}')"></div>`;
    }

    // ═══ DATA LOADING ═══
    async function loadData() {
        const resp = await fetch('/api/data');
        DATA = await resp.json();
        CONTENT = DATA.content || {};
        PHOTOS = DATA.photos || { miniature_photos: {}, type_photos: {} };
        filtered = [...DATA.miniatures];

        // compteurs héros
        setCount('hero-count-total', DATA.stats.total);
        setCount('hero-count-fab', DATA.stats.fabricants);
        setCount('hero-count-types', DATA.stats.types);
        animateCounters();

        // nombre de miniatures de la collection de Pascal (pour le bouton admin)
        const mineBtn = document.getElementById('admin-mine');
        if (mineBtn) {
            mineBtn.dataset.count = DATA.miniatures.filter(
                m => (m.source_info || '').trim().toLowerCase() === MY_COLLECTION).length;
            updateMineButton();
        }

        applyContent();
        initFilters();
        renderCollection();
        renderCharts();
        renderTimeline();
        renderFabricants();
        renderTypes();
        initScrollReveal();

        if (window.Admin) window.Admin.onDataReady();
    }

    function setCount(id, val) {
        const el = document.getElementById(id);
        if (el) el.dataset.count = val;
    }

    /** Recharge la collection depuis le serveur sans recharger la page. */
    async function reload() {
        const resp = await fetch('/api/data');
        DATA = await resp.json();
        CONTENT = DATA.content || {};
        PHOTOS = DATA.photos || { miniature_photos: {}, type_photos: {} };
        applyContent();
        applyFilters();
    }

    // ═══ FILTERS ═══
    let filtersReady = false;
    function initFilters() {
        if (filtersReady) return;
        filtersReady = true;

        const matContainer = document.getElementById('filter-material');
        DATA.stats.materials.forEach(([mat]) => {
            if (mat === 'Non spécifié') return;
            const btn = document.createElement('button');
            btn.className = 'chip'; btn.dataset.value = mat; btn.textContent = mat;
            matContainer.appendChild(btn);
        });
        const marqueSelect = document.getElementById('filter-marque');
        DATA.stats.marques.forEach(([m, c]) => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = `${m} (${c})`;
            marqueSelect.appendChild(opt);
        });
        const typeSelect = document.getElementById('filter-type');
        DATA.stats.top_types.forEach(([t, c]) => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = `Type ${t} (${c})`;
            typeSelect.appendChild(opt);
        });
        const fabSelect = document.getElementById('filter-fabricant');
        DATA.stats.top_fabricants.forEach(([f, c]) => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = `${f.substring(0, 40)} (${c})`;
            fabSelect.appendChild(opt);
        });

        document.getElementById('search-input').addEventListener('input', e => {
            activeFilters.search = e.target.value.toLowerCase();
            document.getElementById('nav-search').value = e.target.value;
            currentPage = 1; applyFilters();
        });
        document.querySelectorAll('.chip-set').forEach(set => {
            set.addEventListener('click', e => {
                const chip = e.target.closest('.chip');
                if (!chip) return;
                set.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                activeFilters[set.id.replace('filter-', '')] = chip.dataset.value;
                currentPage = 1; applyFilters();
            });
        });
        ['filter-marque', 'filter-type', 'filter-fabricant'].forEach(id => {
            document.getElementById(id).addEventListener('change', e => {
                activeFilters[id.replace('filter-', '')] = e.target.value;
                currentPage = 1; applyFilters();
            });
        });
        document.getElementById('reset-filters').addEventListener('click', () => {
            activeFilters = { search: '', echelle: 'all', material: 'all', marque: 'all', type: 'all', fabricant: 'all' };
            document.getElementById('search-input').value = '';
            document.getElementById('nav-search').value = '';
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.chip[data-value="all"]').forEach(c => c.classList.add('active'));
            document.querySelectorAll('.filter-select').forEach(s => s.value = 'all');
            currentPage = 1; applyFilters();
        });
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                document.getElementById('collection-grid').classList.toggle('hidden', currentView !== 'grid');
                document.getElementById('collection-table').classList.toggle('hidden', currentView !== 'table');
                renderCollection();
            });
        });
        document.querySelectorAll('.collection-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortColumn === col) sortAsc = !sortAsc;
                else { sortColumn = col; sortAsc = true; }
                applyFilters();
            });
        });
    }

    function applyFilters() {
        filtered = DATA.miniatures.filter(m => {
            // Filtre admin « Ma collection » : uniquement les miniatures pvm.
            if (showMineOnly && (m.source_info || '').trim().toLowerCase() !== MY_COLLECTION) return false;
            if (activeFilters.search) {
                const searchable = [
                    m.fabricant, m.type_bugatti, m.modele, m.couleur,
                    m.ref, m.chassis, m.marque, m.remarques
                ].filter(Boolean).join(' ').toLowerCase();
                if (!searchable.includes(activeFilters.search)) return false;
            }
            if (activeFilters.echelle !== 'all' && m.echelle !== activeFilters.echelle) return false;
            if (activeFilters.material !== 'all' && m.type_miniature !== activeFilters.material) return false;
            if (activeFilters.marque !== 'all' && m.marque !== activeFilters.marque) return false;
            if (activeFilters.type !== 'all' && m.type_number !== activeFilters.type) return false;
            if (activeFilters.fabricant !== 'all' && m.fabricant !== activeFilters.fabricant) return false;
            return true;
        });
        if (sortColumn) {
            filtered.sort((a, b) => {
                const va = (a[sortColumn] || '').toString();
                const vb = (b[sortColumn] || '').toString();
                return sortAsc ? va.localeCompare(vb, 'fr') : vb.localeCompare(va, 'fr');
            });
        }
        document.getElementById('search-count').textContent =
            filtered.length < DATA.miniatures.length ? `${filtered.length.toLocaleString('fr-FR')} résultats` : '';
        renderCollection();
    }

    // ═══ FILTRE ADMIN « MA COLLECTION » (pvm) ═══
    function updateMineButton() {
        const btn = document.getElementById('admin-mine');
        if (!btn) return;
        const n = btn.dataset.count;
        btn.classList.toggle('active', showMineOnly);
        btn.textContent = (showMineOnly ? '✓ ' : '') + 'Ma collection'
            + (n ? ` (${Number(n).toLocaleString('fr-FR')})` : '');
    }
    function toggleMine() {
        showMineOnly = !showMineOnly;
        updateMineButton();
        currentPage = 1;
        applyFilters();
        document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
    }

    // ═══ COLLECTION RENDERING ═══
    function renderCollection() {
        // borne la page courante (une suppression / un import CSV peut avoir
        // réduit le nombre de pages sous la page affichée).
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * PAGE_SIZE;
        const page = filtered.slice(start, start + PAGE_SIZE);
        if (currentView === 'grid') renderGrid(page);
        else renderTable(page);
        renderPagination();
    }

    function renderGrid(items) {
        const grid = document.getElementById('collection-grid');
        grid.innerHTML = items.map(m => `
            <div class="mini-card" data-id="${m.id}">
                ${photoHtml(m)}
                <div class="card-header">
                    <span class="card-type">${escapeHtml(m.type_bugatti || 'Bugatti')}</span>
                    ${m.echelle ? `<span class="card-echelle">${escapeHtml(m.echelle)}</span>` : ''}
                </div>
                ${m.modele ? `<div class="card-modele">${escapeHtml(m.modele)}</div>` : ''}
                ${m.fabricant ? `<div class="card-fabricant">${escapeHtml(m.fabricant)}</div>` : ''}
                <div class="card-tags">
                    ${m.couleur ? `<span class="card-tag tag-color">${escapeHtml(truncate(m.couleur, 30))}</span>` : ''}
                    ${m.annee ? `<span class="card-tag tag-year">${escapeHtml(String(m.annee))}</span>` : ''}
                    ${m.type_miniature ? `<span class="card-tag tag-material">${escapeHtml(m.type_miniature)}</span>` : ''}
                </div>
            </div>`).join('');
        grid.querySelectorAll('.mini-card').forEach(card => {
            card.addEventListener('click', () => openModal(parseInt(card.dataset.id)));
        });
    }

    function renderTable(items) {
        const tbody = document.getElementById('table-body');
        tbody.innerHTML = items.map(m => `
            <tr data-id="${m.id}">
                <td>${escapeHtml(m.fabricant || '')}</td>
                <td>${escapeHtml(m.ref || '')}</td>
                <td><strong>${escapeHtml(m.type_bugatti || '')}</strong></td>
                <td>${escapeHtml(m.modele || '')}</td>
                <td>${escapeHtml(String(m.annee || ''))}</td>
                <td>${escapeHtml(truncate(m.couleur || '', 25))}</td>
                <td>${escapeHtml(m.echelle || '')}</td>
                <td>${escapeHtml(m.type_miniature || '')}</td>
            </tr>`).join('');
        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => openModal(parseInt(row.dataset.id)));
        });
    }

    function renderPagination() {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        const pag = document.getElementById('pagination');
        if (totalPages <= 1) { pag.innerHTML = ''; return; }
        let html = `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`;
        getPageRange(currentPage, totalPages).forEach(p => {
            html += p === '...'
                ? `<span class="page-info">…</span>`
                : `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
        });
        html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>`;
        html += `<span class="page-info">${filtered.length.toLocaleString('fr-FR')} miniatures</span>`;
        pag.innerHTML = html;
        pag.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                currentPage = parseInt(btn.dataset.page);
                renderCollection();
                document.getElementById('collection').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function getPageRange(current, total) {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        if (current > 3) pages.push('...');
        for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
        if (current < total - 2) pages.push('...');
        pages.push(total);
        return pages;
    }

    // ═══ MODAL ═══
    const FIELD_DEFS = [
        ['fabricant', 'Fabricant'], ['ref', 'Référence'], ['serie', 'Série / Quantité'],
        ['marque', 'Marque'], ['type_bugatti', 'Type Bugatti'], ['modele', 'Modèle'],
        ['chassis', 'Châssis'], ['annee', 'Année véhicule'], ['couleur', 'Couleur'],
        ['echelle', 'Échelle'], ['type_miniature', 'Matériau'],
        ['annee_miniature', 'Année miniature'], ['montage', 'Montage'],
        ['source_photo', 'Source photo'], ['source_info', 'Source info'],
        ['remarques', 'Remarques'],
    ];

    function openModal(id) {
        const m = DATA.miniatures.find(x => x.id === id);
        if (!m) return;
        const modal = document.getElementById('detail-modal');
        const body = document.getElementById('modal-body');
        const admin = isAdmin();

        const photoUrl = getPhotoUrl(m);
        const hasUpload = PHOTOS.miniature_photos[String(m.id)];
        const typePhoto = PHOTOS.type_photos[m.type_number];
        let attribution = '';
        if (!hasUpload && typePhoto) {
            attribution = `<div class="modal-photo-attr">Photo du type — ${escapeHtml(typePhoto.attribution || 'Wikimedia Commons')}</div>`;
        }

        // Champs déjà affichés dans l'en-tête (type/modèle) ou internes
        // (source photo) : masqués au public, éditables en admin.
        const PUBLIC_HIDDEN = ['type_bugatti', 'modele', 'source_photo'];
        // En mode admin, on montre TOUS les champs (même vides) pour les remplir.
        const rows = FIELD_DEFS
            .filter(([k]) => admin || (m[k] && !PUBLIC_HIDDEN.includes(k)))
            .map(([k, label]) => `
            <div class="modal-detail" data-field="${k}">
                <div class="modal-detail-label">${label}</div>
                <div class="modal-detail-value">${escapeHtml(String(m[k] || (admin ? '—' : '')))}</div>
            </div>`).join('');

        body.innerHTML = `
            <div class="modal-photo-section">
                ${photoUrl
                    ? `<div class="modal-photo" style="background-image:url('${cssUrl(photoUrl)}')"></div>${attribution}`
                    : `<div class="modal-photo modal-photo-empty">
                        <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg" width="120">
                            <path d="M15 38 C15 38 18 25 30 22 C38 20 42 18 55 18 C65 18 75 16 85 18 C95 20 100 24 105 30 C107 33 108 36 108 38 Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                            <circle cx="32" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                            <circle cx="92" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                        </svg><span>Aucune photo</span></div>`}
                ${admin ? `<div class="modal-upload">
                    <label class="upload-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        ${hasUpload ? 'Remplacer la photo' : 'Ajouter une photo'}
                        <input type="file" accept="image/*" class="upload-input" data-id="${m.id}" hidden>
                    </label>
                    ${hasUpload ? `<button class="delete-photo-btn" data-id="${m.id}" title="Supprimer la photo">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>` : ''}
                </div>` : ''}
            </div>
            <div class="modal-type-header">
                <div class="modal-type-number">Type ${escapeHtml(m.type_bugatti || '—')}</div>
                ${m.modele ? `<div class="modal-type-name">${escapeHtml(m.modele)}</div>` : ''}
            </div>
            <div class="modal-detail-grid">${rows}</div>
            ${admin ? `<div class="modal-admin-actions">
                <button class="admin-btn admin-btn-danger" id="modal-delete-mini" data-id="${m.id}">Supprimer cette miniature</button>
            </div>` : ''}`;

        if (admin) {
            // crayon sur chaque champ
            body.querySelectorAll('.modal-detail').forEach(cell => {
                const field = cell.dataset.field;
                const label = FIELD_DEFS.find(([k]) => k === field)[1];
                const valEl = cell.querySelector('.modal-detail-value');
                ensurePencil(valEl, () => openEditor({
                    label,
                    value: m[field] || '',
                    multiline: field === 'remarques',
                    onSave: async (val) => {
                        const updated = await window.Admin.saveMiniatureField(m.id, field, val);
                        // remplace l'objet (Object.assign ne pourrait pas
                        // retirer une clé vidée côté serveur).
                        const idx = DATA.miniatures.findIndex(x => x.id === m.id);
                        if (idx >= 0) DATA.miniatures[idx] = updated;
                        openModal(updated.id);   // rafraîchit la fiche
                        applyFilters();          // rafraîchit la grille
                    },
                }));
            });
            wireUpload(body, m);
            const delBtn = body.querySelector('#modal-delete-mini');
            if (delBtn) delBtn.addEventListener('click', () => window.Admin.deleteMiniature(m.id));
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function wireUpload(body, m) {
        const uploadInput = body.querySelector('.upload-input');
        if (uploadInput) {
            uploadInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const url = await window.Admin.uploadPhoto(m.id, file);
                    PHOTOS.miniature_photos[String(m.id)] = { url, source: 'upload' };
                    openModal(m.id); applyFilters();
                    App.toast('Photo ajoutée', 'ok');
                } catch (err) { App.toast(err.message, 'err'); }
            });
        }
        const deleteBtn = body.querySelector('.delete-photo-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                try {
                    await window.Admin.deletePhoto(m.id);
                    delete PHOTOS.miniature_photos[String(m.id)];
                    openModal(m.id); applyFilters();
                } catch (err) { App.toast(err.message, 'err'); }
            });
        }
    }

    function initModal() {
        const modal = document.getElementById('detail-modal');
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    }
    function closeModal() {
        document.getElementById('detail-modal').classList.remove('active');
        document.body.style.overflow = '';
    }

    // ═══ CHARTS ═══
    let chartsRendered = false;
    function renderCharts() {
        if (chartsRendered || typeof Chart === 'undefined') return;
        chartsRendered = true;
        const darkText = 'rgba(255,255,255,0.7)';
        const gridColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.color = darkText;
        Chart.defaults.borderColor = gridColor;

        const topTypes = DATA.stats.top_types.slice(0, 20);
        new Chart(document.getElementById('chart-types'), {
            type: 'bar',
            data: { labels: topTypes.map(([t]) => `Type ${t}`),
                datasets: [{ data: topTypes.map(([, c]) => c),
                    backgroundColor: topTypes.map((_, i) => `rgba(${i * 5}, ${51 + i * 8}, ${153 + i * 4}, 0.8)`),
                    borderRadius: 4, borderSkipped: false }] },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: gridColor }, ticks: { color: darkText } },
                    y: { grid: { display: false }, ticks: { color: darkText, font: { size: 11 } } } } }
        });

        const mats = DATA.stats.materials.filter(([m]) => m !== 'Non spécifié');
        new Chart(document.getElementById('chart-materials'), {
            type: 'doughnut',
            data: { labels: mats.map(([m]) => m),
                datasets: [{ data: mats.map(([, c]) => c),
                    backgroundColor: ['#003399', '#c41e3a', '#c9a84c', '#2d6a4f', '#6c757d'],
                    borderWidth: 2, borderColor: '#14142a' }] },
            options: { responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: darkText, padding: 15, usePointStyle: true } } },
                cutout: '65%' }
        });

        const topFabs = DATA.stats.top_fabricants.slice(0, 15);
        new Chart(document.getElementById('chart-fabricants'), {
            type: 'bar',
            data: { labels: topFabs.map(([f]) => f.length > 25 ? f.substring(0, 25) + '…' : f),
                datasets: [{ data: topFabs.map(([, c]) => c),
                    backgroundColor: 'rgba(201, 168, 76, 0.7)', borderRadius: 4, borderSkipped: false }] },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: gridColor }, ticks: { color: darkText } },
                    y: { grid: { display: false }, ticks: { color: darkText, font: { size: 10 } } } } }
        });

        const decades = DATA.stats.decades;
        new Chart(document.getElementById('chart-decades'), {
            type: 'bar',
            data: { labels: decades.map(([d]) => d),
                datasets: [{ label: 'Miniatures produites', data: decades.map(([, c]) => c),
                    backgroundColor: decades.map((_, i) => {
                        const r = i / Math.max(decades.length, 1);
                        return `rgba(${Math.floor(r * 196)}, ${Math.floor(51 - r * 21)}, ${Math.floor(153 - r * 95)}, 0.8)`;
                    }), borderRadius: 6, borderSkipped: false }] },
            options: { responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { color: darkText } },
                    y: { grid: { color: gridColor }, ticks: { color: darkText } } } }
        });
    }

    // ═══ TIMELINE ═══
    function renderTimeline() {
        const eras = [
            { label: '1900–1914', subtitle: 'Les Débuts', range: [1900, 1914] },
            { label: '1920–1929', subtitle: 'L\'Âge d\'Or', range: [1920, 1929] },
            { label: '1930–1939', subtitle: 'L\'Apogée', range: [1930, 1939] },
            { label: '1940–1959', subtitle: 'L\'Après-guerre', range: [1940, 1959] },
            { label: '1960–1979', subtitle: 'Renaissance', range: [1960, 1979] },
            { label: '1980–1999', subtitle: 'EB110 & Renouveau', range: [1980, 1999] },
            { label: '2000–2020', subtitle: 'Veyron & Chiron', range: [2000, 2020] },
        ];
        const track = document.getElementById('timeline-track');
        track.innerHTML = eras.map(era => {
            const typesInEra = {};
            DATA.miniatures.forEach(m => {
                const year = parseInt(m.annee);
                if (!isNaN(year) && year >= era.range[0] && year <= era.range[1]) {
                    const tb = m.type_bugatti || 'Autre';
                    typesInEra[tb] = (typesInEra[tb] || 0) + 1;
                }
            });
            const sorted = Object.entries(typesInEra).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const total = Object.values(typesInEra).reduce((a, b) => a + b, 0);
            return `
                <div class="timeline-era">
                    <div class="timeline-dot"></div>
                    <div class="timeline-era-header">
                        <div class="timeline-year">${era.label}</div>
                        <div class="timeline-era-subtitle">${era.subtitle} — ${total.toLocaleString('fr-FR')} miniatures</div>
                    </div>
                    <div class="timeline-items">
                        ${sorted.map(([type, count]) => `
                            <div class="timeline-item" data-type="${escapeHtml(type)}">
                                <strong>Type ${escapeHtml(type)}</strong>
                                <div class="timeline-item-count">${count} miniature${count > 1 ? 's' : ''}</div>
                            </div>`).join('')}
                    </div>
                </div>`;
        }).join('');
        track.querySelectorAll('.timeline-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                document.getElementById('search-input').value = type;
                activeFilters.search = type.toLowerCase();
                currentPage = 1; applyFilters();
                document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    // ═══ FABRICANTS ═══
    function renderFabricants() {
        const allFabs = DATA.stats.top_fabricants;
        const maxCount = allFabs.length > 0 ? allFabs[0][1] : 1;
        const grid = document.getElementById('fabricants-grid');
        function render(fabs) {
            grid.innerHTML = fabs.map(([name, count]) => `
                <div class="fab-card" data-fab="${escapeHtml(name)}" style="position:relative;overflow:hidden">
                    <span class="fab-name">${escapeHtml(name)}</span>
                    <span class="fab-count">${count.toLocaleString('fr-FR')}</span>
                    <div class="fab-bar" style="width:${(count / maxCount * 100).toFixed(1)}%"></div>
                </div>`).join('');
            grid.querySelectorAll('.fab-card').forEach(card => {
                card.addEventListener('click', () => {
                    const fab = card.dataset.fab;
                    document.getElementById('search-input').value = fab;
                    activeFilters.search = fab.toLowerCase();
                    currentPage = 1; applyFilters();
                    document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
                });
            });
        }
        render(allFabs);
        document.getElementById('fab-search').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            render(allFabs.filter(([name]) => name.toLowerCase().includes(q)));
        });
    }

    // ═══ TYPES TREEMAP ═══
    function renderTypes() {
        const types = DATA.stats.top_types;
        const maxCount = types.length > 0 ? types[0][1] : 1;
        const container = document.getElementById('types-treemap');
        const typeNames = {
            '13': 'Brescia', '23': 'Brescia Modifié', '30': 'Grand Prix', '32': 'Tank',
            '35': 'Grand Prix', '37': 'Grand Prix', '38': 'Touring', '40': 'Fiacre',
            '41': 'Royale', '43': 'Grand Sport', '44': 'Touring', '46': 'Super Profil',
            '49': 'Berline', '50': 'Super Sport', '51': 'Grand Prix', '53': '4WD',
            '55': 'Super Sport', '57': 'Sport/Atalante', '59': 'Grand Prix', '64': 'Coupé',
            '73': 'Berline', '101': 'Berline', '110': 'EB110', '252': 'Berline',
        };
        container.innerHTML = types.map(([type, count]) => {
            let sizeClass = '';
            if (count > maxCount * 0.6) sizeClass = 'size-xl';
            else if (count > maxCount * 0.25) sizeClass = 'size-lg';
            const name = typeNames[type] || '';
            return `
                <div class="type-cell ${sizeClass}" data-type="${type}">
                    <div class="type-num">${type}</div>
                    ${name ? `<div class="type-label">${name}</div>` : ''}
                    <div class="type-count">${count.toLocaleString('fr-FR')} miniature${count > 1 ? 's' : ''}</div>
                </div>`;
        }).join('');
        container.querySelectorAll('.type-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const type = cell.dataset.type;
                document.getElementById('filter-type').value = type;
                activeFilters.type = type;
                currentPage = 1; applyFilters();
                document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    // ═══ UTILS ═══
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    function truncate(str, len) {
        return str.length > len ? str.substring(0, len) + '…' : str;
    }
    // Neutralise les caractères qui pourraient s'échapper d'un url('...') CSS.
    function cssUrl(url) {
        return String(url).replace(/['"()\\]/g, c => encodeURIComponent(c));
    }

    // ═══ API PUBLIQUE (consommée par admin.js) ═══
    window.App = {
        openModal,
        openEditor,
        reload,
        applyFilters,
        toast(msg, type) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.className = 'toast show ' + (type || '');
            clearTimeout(t._timer);
            t._timer = setTimeout(() => { t.className = 'toast'; }, 2600);
        },
        /** Bascule le mode admin : affiche/masque les crayons et refait le rendu. */
        setAdminMode(on) {
            document.body.classList.toggle('admin-mode', !!on);
            // En quittant l'admin, on annule le filtre perso pour que le public
            // retrouve toute la collection.
            if (!on && showMineOnly) { showMineOnly = false; updateMineButton(); }
            if (DATA) applyFilters();  // ré-applique les filtres + rend la grille
        },
        getData() { return DATA; },
    };

    // ═══ INIT ═══
    document.addEventListener('DOMContentLoaded', () => {
        initHeroCanvas();
        initNav();
        initModal();
        const mineBtn = document.getElementById('admin-mine');
        if (mineBtn) mineBtn.addEventListener('click', toggleMine);
        loadData();
    });
})();

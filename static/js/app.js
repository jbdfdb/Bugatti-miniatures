/* ═══════════════════════════════════════════════════════════
   Les Bugatti de Pascal — Application JavaScript
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ═══ STATE ═══
    let DATA = null;
    let PHOTOS = { miniature_photos: {}, type_photos: {} };
    let filtered = [];
    let currentPage = 1;
    const PAGE_SIZE = 48;
    let currentView = 'grid';
    let sortColumn = null;
    let sortAsc = true;
    let activeFilters = {
        search: '',
        echelle: 'all',
        material: 'all',
        marque: 'all',
        type: 'all',
        fabricant: 'all',
    };

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
                // Gold or blue
                this.color = Math.random() > 0.7
                    ? `rgba(201, 168, 76, ${this.opacity})`
                    : `rgba(100, 140, 220, ${this.opacity * 0.5})`;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                if (this.x < 0 || this.x > w || this.y < 0 || this.y > h) this.reset();
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.fill();
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
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
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

        window.addEventListener('resize', () => { resize(); });
        init();
        animate();
    }

    // ═══ COUNTER ANIMATION ═══
    function animateCounters() {
        document.querySelectorAll('[data-count]').forEach(el => {
            const target = parseInt(el.dataset.count);
            const duration = 2000;
            const start = performance.now();
            function tick(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
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
        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const y = window.scrollY;
            if (y > 300) {
                nav.classList.add('visible');
            } else {
                nav.classList.remove('visible');
            }
            // Active section highlighting
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
            lastScroll = y;
        });

        // Nav search syncs with main search
        document.getElementById('nav-search').addEventListener('input', e => {
            const searchInput = document.getElementById('search-input');
            searchInput.value = e.target.value;
            activeFilters.search = e.target.value.toLowerCase();
            applyFilters();
            // Scroll to collection
            if (e.target.value.length > 0) {
                document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // ═══ SCROLL REVEAL ═══
    function initScrollReveal() {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('.section-header, .stat-card, .timeline-era').forEach(el => {
            el.classList.add('fade-in');
            observer.observe(el);
        });
    }

    // ═══ PHOTO HELPERS ═══
    function getPhotoUrl(miniature) {
        // 1. Check for user-uploaded photo
        const uploaded = PHOTOS.miniature_photos[String(miniature.id)];
        if (uploaded) return uploaded.url;
        // 2. Check for type-level photo from Wikimedia by type_number
        const typePhoto = PHOTOS.type_photos[miniature.type_number];
        if (typePhoto) return typePhoto.url;
        // 3. Check by keyword matching for modern Bugatti (Veyron, Chiron, etc.)
        const tb = (miniature.type_bugatti || '').toLowerCase();
        const modernMap = {
            'veyron': 'veyron', 'chiron': 'chiron', 'divo': 'divo',
            'bolide': 'bolide', 'voiture noire': 'la_voiture_noire',
            'eb110': '110', 'eb 110': '110',
        };
        for (const [kw, key] of Object.entries(modernMap)) {
            if (tb.includes(kw) && PHOTOS.type_photos[key]) {
                return PHOTOS.type_photos[key].url;
            }
        }
        return null;
    }

    function photoHtml(miniature, size) {
        const url = getPhotoUrl(miniature);
        if (!url) {
            // SVG placeholder with Bugatti silhouette
            return `<div class="card-photo card-photo-placeholder ${size || ''}">
                <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 38 C15 38 18 25 30 22 C38 20 42 18 55 18 C65 18 75 16 85 18 C95 20 100 24 105 30 C107 33 108 36 108 38 Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                    <circle cx="32" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                    <circle cx="92" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
                </svg>
            </div>`;
        }
        return `<div class="card-photo ${size || ''}" style="background-image:url('${url}')"></div>`;
    }

    // ═══ DATA LOADING ═══
    async function loadData() {
        const [dataResp, photosResp] = await Promise.all([
            fetch('/static/data.json'),
            fetch('/api/photos'),
        ]);
        DATA = await dataResp.json();
        PHOTOS = await photosResp.json();
        filtered = [...DATA.miniatures];
        initFilters();
        renderCollection();
        renderCharts();
        renderTimeline();
        renderFabricants();
        renderTypes();
        initScrollReveal();
    }

    // ═══ FILTERS ═══
    function initFilters() {
        // Populate material chips
        const matContainer = document.getElementById('filter-material');
        DATA.stats.materials.forEach(([mat]) => {
            if (mat === 'Non spécifié') return;
            const btn = document.createElement('button');
            btn.className = 'chip';
            btn.dataset.value = mat;
            btn.textContent = mat;
            matContainer.appendChild(btn);
        });

        // Populate selects
        const marqueSelect = document.getElementById('filter-marque');
        DATA.stats.marques.forEach(([m, c]) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = `${m} (${c})`;
            marqueSelect.appendChild(opt);
        });

        const typeSelect = document.getElementById('filter-type');
        DATA.stats.top_types.forEach(([t, c]) => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = `Type ${t} (${c})`;
            typeSelect.appendChild(opt);
        });

        const fabSelect = document.getElementById('filter-fabricant');
        DATA.stats.top_fabricants.forEach(([f, c]) => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = `${f.substring(0, 40)} (${c})`;
            fabSelect.appendChild(opt);
        });

        // Search input
        document.getElementById('search-input').addEventListener('input', e => {
            activeFilters.search = e.target.value.toLowerCase();
            document.getElementById('nav-search').value = e.target.value;
            currentPage = 1;
            applyFilters();
        });

        // Chip clicks
        document.querySelectorAll('.chip-set').forEach(set => {
            set.addEventListener('click', e => {
                const chip = e.target.closest('.chip');
                if (!chip) return;
                set.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const filterId = set.id.replace('filter-', '');
                activeFilters[filterId] = chip.dataset.value;
                currentPage = 1;
                applyFilters();
            });
        });

        // Select changes
        ['filter-marque', 'filter-type', 'filter-fabricant'].forEach(id => {
            document.getElementById(id).addEventListener('change', e => {
                const key = id.replace('filter-', '');
                activeFilters[key] = e.target.value;
                currentPage = 1;
                applyFilters();
            });
        });

        // Reset
        document.getElementById('reset-filters').addEventListener('click', () => {
            activeFilters = { search: '', echelle: 'all', material: 'all', marque: 'all', type: 'all', fabricant: 'all' };
            document.getElementById('search-input').value = '';
            document.getElementById('nav-search').value = '';
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.chip[data-value="all"]').forEach(c => c.classList.add('active'));
            document.querySelectorAll('.filter-select').forEach(s => s.value = 'all');
            currentPage = 1;
            applyFilters();
        });

        // View toggles
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

        // Table sorting
        document.querySelectorAll('.collection-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortColumn === col) { sortAsc = !sortAsc; }
                else { sortColumn = col; sortAsc = true; }
                applyFilters();
            });
        });
    }

    function applyFilters() {
        filtered = DATA.miniatures.filter(m => {
            if (activeFilters.search) {
                const s = activeFilters.search;
                const searchable = [
                    m.fabricant, m.type_bugatti, m.modele, m.couleur,
                    m.ref, m.chassis, m.marque, m.remarques
                ].filter(Boolean).join(' ').toLowerCase();
                if (!searchable.includes(s)) return false;
            }
            if (activeFilters.echelle !== 'all' && m.echelle !== activeFilters.echelle) return false;
            if (activeFilters.material !== 'all' && m.type_miniature !== activeFilters.material) return false;
            if (activeFilters.marque !== 'all' && m.marque !== activeFilters.marque) return false;
            if (activeFilters.type !== 'all' && m.type_number !== activeFilters.type) return false;
            if (activeFilters.fabricant !== 'all' && m.fabricant !== activeFilters.fabricant) return false;
            return true;
        });

        // Sort
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

    // ═══ COLLECTION RENDERING ═══
    function renderCollection() {
        const start = (currentPage - 1) * PAGE_SIZE;
        const page = filtered.slice(start, start + PAGE_SIZE);

        if (currentView === 'grid') {
            renderGrid(page);
        } else {
            renderTable(page);
        }
        renderPagination();
    }

    function renderGrid(items) {
        const grid = document.getElementById('collection-grid');
        grid.innerHTML = items.map(m => `
            <div class="mini-card" data-id="${m.id}">
                ${photoHtml(m)}
                <div class="card-header">
                    <span class="card-type">${escapeHtml(m.type_bugatti || 'Bugatti')}</span>
                    ${m.echelle ? `<span class="card-echelle">${m.echelle}</span>` : ''}
                </div>
                ${m.modele ? `<div class="card-modele">${escapeHtml(m.modele)}</div>` : ''}
                ${m.fabricant ? `<div class="card-fabricant">${escapeHtml(m.fabricant)}</div>` : ''}
                <div class="card-tags">
                    ${m.couleur ? `<span class="card-tag tag-color">${escapeHtml(truncate(m.couleur, 30))}</span>` : ''}
                    ${m.annee ? `<span class="card-tag tag-year">${m.annee}</span>` : ''}
                    ${m.type_miniature ? `<span class="card-tag tag-material">${m.type_miniature}</span>` : ''}
                </div>
            </div>
        `).join('');

        // Card click
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
                <td>${m.annee || ''}</td>
                <td>${escapeHtml(truncate(m.couleur || '', 25))}</td>
                <td>${m.echelle || ''}</td>
                <td>${m.type_miniature || ''}</td>
            </tr>
        `).join('');

        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => openModal(parseInt(row.dataset.id)));
        });
    }

    function renderPagination() {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        const pag = document.getElementById('pagination');
        if (totalPages <= 1) { pag.innerHTML = ''; return; }

        let html = '';
        html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`;

        const range = getPageRange(currentPage, totalPages);
        range.forEach(p => {
            if (p === '...') {
                html += `<span class="page-info">…</span>`;
            } else {
                html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
            }
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
        const pages = [];
        pages.push(1);
        if (current > 3) pages.push('...');
        for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
            pages.push(i);
        }
        if (current < total - 2) pages.push('...');
        pages.push(total);
        return pages;
    }

    // ═══ MODAL ═══
    function openModal(id) {
        const m = DATA.miniatures.find(x => x.id === id);
        if (!m) return;
        const modal = document.getElementById('detail-modal');
        const body = document.getElementById('modal-body');

        const fields = [
            ['Fabricant', m.fabricant],
            ['Référence', m.ref],
            ['Série / Quantité', m.serie],
            ['Marque', m.marque],
            ['Châssis', m.chassis],
            ['Année véhicule', m.annee],
            ['Couleur', m.couleur],
            ['Échelle', m.echelle],
            ['Matériau', m.type_miniature],
            ['Année miniature', m.annee_miniature],
            ['Montage', m.montage],
            ['Source info', m.source_info],
        ].filter(([, v]) => v);

        const photoUrl = getPhotoUrl(m);
        const hasUpload = PHOTOS.miniature_photos[String(m.id)];
        const typePhoto = PHOTOS.type_photos[m.type_number];
        let attribution = '';
        if (!hasUpload && typePhoto) {
            attribution = `<div class="modal-photo-attr">Photo du type — ${escapeHtml(typePhoto.attribution || 'Wikimedia Commons')}</div>`;
        }

        body.innerHTML = `
            <div class="modal-photo-section">
                ${photoUrl
                    ? `<div class="modal-photo" style="background-image:url('${photoUrl}')"></div>${attribution}`
                    : `<div class="modal-photo modal-photo-empty">
                        <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg" width="120">
                            <path d="M15 38 C15 38 18 25 30 22 C38 20 42 18 55 18 C65 18 75 16 85 18 C95 20 100 24 105 30 C107 33 108 36 108 38 Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                            <circle cx="32" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                            <circle cx="92" cy="38" r="6" stroke="currentColor" stroke-width="1" fill="none" opacity="0.3"/>
                        </svg>
                        <span>Aucune photo</span>
                    </div>`
                }
                <div class="modal-upload">
                    <label class="upload-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        ${hasUpload ? 'Remplacer la photo' : 'Ajouter une photo'}
                        <input type="file" accept="image/*" class="upload-input" data-id="${m.id}" hidden>
                    </label>
                    ${hasUpload ? `<button class="delete-photo-btn" data-id="${m.id}" title="Supprimer la photo">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>` : ''}
                </div>
            </div>
            <div class="modal-type-header">
                <div class="modal-type-number">Type ${escapeHtml(m.type_bugatti || '—')}</div>
                ${m.modele ? `<div class="modal-type-name">${escapeHtml(m.modele)}</div>` : ''}
            </div>
            <div class="modal-detail-grid">
                ${fields.map(([label, val]) => `
                    <div class="modal-detail">
                        <div class="modal-detail-label">${label}</div>
                        <div class="modal-detail-value">${escapeHtml(String(val))}</div>
                    </div>
                `).join('')}
            </div>
            ${m.remarques ? `<div class="modal-remarques">${escapeHtml(m.remarques)}</div>` : ''}
        `;

        // Upload handler
        const uploadInput = body.querySelector('.upload-input');
        if (uploadInput) {
            uploadInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const formData = new FormData();
                formData.append('miniature_id', m.id);
                formData.append('photo', file);
                const resp = await fetch('/api/upload-photo', { method: 'POST', body: formData });
                const result = await resp.json();
                if (result.success) {
                    PHOTOS.miniature_photos[String(m.id)] = { url: result.url, source: 'upload' };
                    openModal(m.id); // Refresh modal
                    renderCollection(); // Refresh grid
                }
            });
        }

        // Delete handler
        const deleteBtn = body.querySelector('.delete-photo-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                await fetch(`/api/photo/${m.id}`, { method: 'DELETE' });
                delete PHOTOS.miniature_photos[String(m.id)];
                openModal(m.id);
                renderCollection();
            });
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
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
    function renderCharts() {
        const darkText = 'rgba(255,255,255,0.7)';
        const gridColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.color = darkText;
        Chart.defaults.borderColor = gridColor;

        // Types chart — horizontal bar
        const topTypes = DATA.stats.top_types.slice(0, 20);
        new Chart(document.getElementById('chart-types'), {
            type: 'bar',
            data: {
                labels: topTypes.map(([t]) => `Type ${t}`),
                datasets: [{
                    data: topTypes.map(([, c]) => c),
                    backgroundColor: topTypes.map((_, i) =>
                        `rgba(${0 + i * 5}, ${51 + i * 8}, ${153 + i * 4}, 0.8)`
                    ),
                    borderRadius: 4,
                    borderSkipped: false,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: darkText } },
                    y: { grid: { display: false }, ticks: { color: darkText, font: { size: 11 } } }
                }
            }
        });

        // Materials doughnut
        const mats = DATA.stats.materials.filter(([m]) => m !== 'Non spécifié');
        new Chart(document.getElementById('chart-materials'), {
            type: 'doughnut',
            data: {
                labels: mats.map(([m]) => m),
                datasets: [{
                    data: mats.map(([, c]) => c),
                    backgroundColor: ['#003399', '#c41e3a', '#c9a84c', '#2d6a4f', '#6c757d'],
                    borderWidth: 2,
                    borderColor: '#14142a',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: darkText, padding: 15, usePointStyle: true }
                    }
                },
                cutout: '65%',
            }
        });

        // Top fabricants
        const topFabs = DATA.stats.top_fabricants.slice(0, 15);
        new Chart(document.getElementById('chart-fabricants'), {
            type: 'bar',
            data: {
                labels: topFabs.map(([f]) => f.length > 25 ? f.substring(0, 25) + '…' : f),
                datasets: [{
                    data: topFabs.map(([, c]) => c),
                    backgroundColor: 'rgba(201, 168, 76, 0.7)',
                    borderRadius: 4,
                    borderSkipped: false,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: darkText } },
                    y: { grid: { display: false }, ticks: { color: darkText, font: { size: 10 } } }
                }
            }
        });

        // Decades
        const decades = DATA.stats.decades;
        new Chart(document.getElementById('chart-decades'), {
            type: 'bar',
            data: {
                labels: decades.map(([d]) => d),
                datasets: [{
                    label: 'Miniatures produites',
                    data: decades.map(([, c]) => c),
                    backgroundColor: decades.map((_, i) => {
                        const ratio = i / decades.length;
                        return `rgba(${Math.floor(0 + ratio * 196)}, ${Math.floor(51 - ratio * 21)}, ${Math.floor(153 - ratio * 95)}, 0.8)`;
                    }),
                    borderRadius: 6,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: darkText } },
                    y: { grid: { color: gridColor }, ticks: { color: darkText } }
                }
            }
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
            // Find types in this era
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
                        <div class="timeline-era-subtitle">${era.subtitle} — ${total} miniatures</div>
                    </div>
                    <div class="timeline-items">
                        ${sorted.map(([type, count]) => `
                            <div class="timeline-item" data-type="${escapeHtml(type)}">
                                <strong>Type ${escapeHtml(type)}</strong>
                                <div class="timeline-item-count">${count} miniature${count > 1 ? 's' : ''}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');

        // Click on timeline item → filter
        track.querySelectorAll('.timeline-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                document.getElementById('search-input').value = type;
                activeFilters.search = type.toLowerCase();
                currentPage = 1;
                applyFilters();
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
                    <span class="fab-count">${count}</span>
                    <div class="fab-bar" style="width:${(count / maxCount * 100).toFixed(1)}%"></div>
                </div>
            `).join('');

            grid.querySelectorAll('.fab-card').forEach(card => {
                card.addEventListener('click', () => {
                    const fab = card.dataset.fab;
                    document.getElementById('search-input').value = fab;
                    activeFilters.search = fab.toLowerCase();
                    currentPage = 1;
                    applyFilters();
                    document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
                });
            });
        }

        render(allFabs);

        document.getElementById('fab-search').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            const filt = allFabs.filter(([name]) => name.toLowerCase().includes(q));
            render(filt);
        });
    }

    // ═══ TYPES TREEMAP ═══
    function renderTypes() {
        const types = DATA.stats.top_types;
        const maxCount = types.length > 0 ? types[0][1] : 1;
        const container = document.getElementById('types-treemap');

        // Famous Bugatti types for labels
        const typeNames = {
            '13': 'Brescia', '23': 'Brescia Modifié', '30': 'Grand Prix',
            '32': 'Tank', '35': 'Grand Prix', '37': 'Grand Prix',
            '38': 'Touring', '40': 'Fiacre', '41': 'Royale',
            '43': 'Grand Sport', '44': 'Touring', '46': 'Super Profil',
            '49': 'Berline', '50': 'Super Sport', '51': 'Grand Prix',
            '53': '4WD', '55': 'Super Sport', '57': 'Sport/Atalante',
            '59': 'Grand Prix', '64': 'Coupé', '73': 'Berline',
            '101': 'Berline', '110': 'EB110', '252': 'Berline',
        };

        container.innerHTML = types.map(([type, count], idx) => {
            let sizeClass = '';
            if (count > maxCount * 0.6) sizeClass = 'size-xl';
            else if (count > maxCount * 0.25) sizeClass = 'size-lg';

            const name = typeNames[type] || '';
            return `
                <div class="type-cell ${sizeClass}" data-type="${type}">
                    <div class="type-num">${type}</div>
                    ${name ? `<div class="type-label">${name}</div>` : ''}
                    <div class="type-count">${count} miniature${count > 1 ? 's' : ''}</div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.type-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const type = cell.dataset.type;
                const sel = document.getElementById('filter-type');
                sel.value = type;
                activeFilters.type = type;
                currentPage = 1;
                applyFilters();
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

    // ═══ INIT ═══
    document.addEventListener('DOMContentLoaded', () => {
        initHeroCanvas();
        animateCounters();
        initNav();
        initModal();
        loadData();
    });

})();

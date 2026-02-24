/* ═══════════════════════════════════════════════════════════
   WBR Dashboard — Interactive Charts & Logic
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Chart.js global defaults ────────────────────────────
    Chart.defaults.color = '#8888aa';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10, 10, 26, 0.92)';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 229, 255, 0.2)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
    Chart.defaults.animation.duration = 800;
    Chart.defaults.animation.easing = 'easeOutQuart';

    // ── Color palette ───────────────────────────────────────
    const COLORS = {
        cyan: '#00e5ff',
        purple: '#a855f7',
        pink: '#ec4899',
        green: '#22d3ee',
        amber: '#f59e0b',
        red: '#ef4444',
        blue: '#3b82f6',
        teal: '#14b8a6',
    };

    function alpha(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    function gradient(ctx, hex1, hex2, vertical = true) {
        const g = vertical
            ? ctx.createLinearGradient(0, 0, 0, ctx.canvas.height)
            : ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
        g.addColorStop(0, alpha(hex1, 0.5));
        g.addColorStop(1, alpha(hex2, 0.02));
        return g;
    }

    // ── State ───────────────────────────────────────────────
    let DATA = null;
    let charts = {};
    let selectedWeekIdx = -1; // -1 = latest

    // Find the best default week — match current real-world week number
    function findDefaultWeekIdx(reviews) {
        if (!reviews.length) return 0;

        // Calculate current ISO week number
        const now = new Date();
        const jan1 = new Date(now.getFullYear(), 0, 1);
        const days = Math.floor((now - jan1) / 86400000);
        const currentWeek = Math.ceil((days + jan1.getDay() + 1) / 7);
        const lastCompletedWeek = currentWeek - 1;
        const targetLabel = 'W' + lastCompletedWeek;

        // Try to find the exact last completed week
        const exactMatch = reviews.findIndex(r => r.week === targetLabel);
        if (exactMatch !== -1 && reviews[exactMatch].total_tasks > 0) {
            return exactMatch;
        }

        // Fallback: find the closest week at or before target that has data
        let best = reviews.length - 1;
        for (let i = reviews.length - 1; i >= 0; i--) {
            const wNum = parseInt(reviews[i].week.replace(/\D/g, '')) || 0;
            if (wNum <= lastCompletedWeek && reviews[i].total_tasks > 0) {
                best = i;
                break;
            }
        }
        return best;
    }

    // ── Boot ────────────────────────────────────────────────
    fetch('wbr_history.json')
        .then(r => r.json())
        .then(raw => {
            DATA = processData(raw);
            selectedWeekIdx = findDefaultWeekIdx(DATA.reviews);
            hideLoading();
            render();
        })
        .catch(err => {
            console.error('Failed to load WBR data:', err);
            document.getElementById('loading').innerHTML =
                '<div class="empty-state"><div class="empty-state__icon">📭</div>' +
                '<p>Could not load WBR data.<br>Make sure <code>wbr_history.json</code> is in this folder.</p></div>';
        });

    function processData(raw) {
        const reviews = raw.reviews || [];
        return {
            reviews,
            weeks: reviews.map(r => r.week),
            lastUpdated: raw.last_updated,
        };
    }

    function hideLoading() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = '';
    }

    // ── Render everything ───────────────────────────────────
    function render() {
        populateSelectors();
        renderKPIs();
        renderSparklines();
        renderCharts();
        renderComparison();
        bindEvents();
        updateLastUpdated();
    }

    // ── Selectors ───────────────────────────────────────────
    function populateSelectors() {
        const weekSel = document.getElementById('weekSelector');
        const compA = document.getElementById('compareA');
        const compB = document.getElementById('compareB');

        DATA.weeks.forEach((w, i) => {
            const opt = (sel) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = w;
                sel.appendChild(o);
            };
            opt(weekSel);
            opt(compA);
            opt(compB);
        });

        weekSel.value = selectedWeekIdx;

        // Default comparison: latest vs previous
        if (DATA.weeks.length >= 2) {
            compA.value = DATA.weeks.length - 1;
            compB.value = DATA.weeks.length - 2;
        }
    }

    // ── KPI Cards ───────────────────────────────────────────
    function renderKPIs() {
        const current = DATA.reviews[selectedWeekIdx];
        const previous = selectedWeekIdx > 0 ? DATA.reviews[selectedWeekIdx - 1] : null;

        animateValue('kpiTotalTasks', current.total_tasks);
        animateValue('kpiCompletion', current.completion_rate, '%');
        animateValue('kpiCritical', current.critical_over_sla);
        animateValue('kpiDebt', current.debt_hrs, 'h');

        setTrend('kpiTotalTasksTrend', current.total_tasks, previous?.total_tasks, false);
        setTrend('kpiCompletionTrend', current.completion_rate, previous?.completion_rate, true);
        setTrend('kpiCriticalTrend', current.critical_over_sla, previous?.critical_over_sla, false, true);
        setTrend('kpiDebtTrend', current.debt_hrs, previous?.debt_hrs, false, true);
    }

    function animateValue(id, target, suffix = '') {
        const el = document.getElementById(id);
        const isFloat = !Number.isInteger(target);
        const duration = 600;
        const start = performance.now();
        const from = 0;

        function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const val = from + (target - from) * eased;
            el.textContent = (isFloat ? val.toFixed(1) : Math.round(val)) + suffix;
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function setTrend(id, current, previous, isPercent = false, invertColor = false) {
        const el = document.getElementById(id);
        if (previous == null) {
            el.textContent = '';
            el.className = 'kpi-card__trend';
            return;
        }
        const diff = current - previous;
        const pct = previous !== 0 ? ((diff / previous) * 100).toFixed(1) : '∞';
        const isUp = diff > 0;
        const isNeutral = diff === 0;

        // For some metrics (critical, debt), up = bad
        let trendClass;
        if (isNeutral) {
            trendClass = 'kpi-card__trend--neutral';
        } else if (invertColor) {
            trendClass = isUp ? 'kpi-card__trend--down' : 'kpi-card__trend--up';
        } else {
            trendClass = isUp ? 'kpi-card__trend--up' : 'kpi-card__trend--down';
        }

        const arrow = isNeutral ? '→' : isUp ? '↑' : '↓';
        const sign = diff > 0 ? '+' : '';

        el.className = `kpi-card__trend ${trendClass}`;
        el.textContent = `${arrow} ${sign}${isPercent ? diff.toFixed(1) + '%' : diff} (${sign}${pct}%)`;
    }

    // ── Sparklines (tiny charts inside KPI cards) ───────────
    function renderSparklines() {
        renderSparkline('sparkTotalTasks', DATA.reviews.map(r => r.total_tasks), COLORS.cyan);
        renderSparkline('sparkCompletion', DATA.reviews.map(r => r.completion_rate), COLORS.green);
        renderSparkline('sparkCritical', DATA.reviews.map(r => r.critical_over_sla), COLORS.red);
        renderSparkline('sparkDebt', DATA.reviews.map(r => r.debt_hrs), COLORS.amber);
    }

    function renderSparkline(canvasId, values, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        // Sizing
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = 50 * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = 50;
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const range = max - min || 1;
        const step = w / Math.max(values.length - 1, 1);

        ctx.clearRect(0, 0, w, h);

        // Fill
        ctx.beginPath();
        ctx.moveTo(0, h);
        values.forEach((v, i) => {
            const x = i * step;
            const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, alpha(color, 0.25));
        grad.addColorStop(1, alpha(color, 0));
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        values.forEach((v, i) => {
            const x = i * step;
            const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // ── Main Charts ─────────────────────────────────────────
    function renderCharts() {
        Object.values(charts).forEach(c => c.destroy());
        charts = {};

        charts.tasks = chartTasks();
        charts.dueDone = chartDueDone();
        charts.completion = chartCompletion();
        charts.kpis = chartKPIs();
        charts.planning = chartPlanning();
    }

    function chartTasks() {
        const ctx = document.getElementById('canvasTasks').getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: DATA.weeks,
                datasets: [
                    {
                        label: 'Auto Tasks',
                        data: DATA.reviews.map(r => r.auto_tasks),
                        backgroundColor: alpha(COLORS.cyan, 0.7),
                        hoverBackgroundColor: COLORS.cyan,
                        borderRadius: 3,
                        borderSkipped: false,
                    },
                    {
                        label: 'Data Tasks',
                        data: DATA.reviews.map(r => r.data_tasks),
                        backgroundColor: alpha(COLORS.purple, 0.7),
                        hoverBackgroundColor: COLORS.purple,
                        borderRadius: 3,
                        borderSkipped: false,
                    },
                    {
                        label: 'Other',
                        data: DATA.reviews.map(r => Math.max(0, r.total_tasks - r.auto_tasks - r.data_tasks)),
                        backgroundColor: alpha(COLORS.blue, 0.5),
                        hoverBackgroundColor: COLORS.blue,
                        borderRadius: 3,
                        borderSkipped: false,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                barPercentage: 0.85,
                categoryPercentage: 0.8,
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8, font: { size: 10 } } },
                    y: { stacked: true, beginAtZero: true }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                return `Total: ${DATA.reviews[idx].total_tasks}`;
                            }
                        }
                    }
                }
            }
        });
    }

    function chartDueDone() {
        const ctx = document.getElementById('canvasDueDone').getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: DATA.weeks,
                datasets: [
                    {
                        label: 'Due',
                        data: DATA.reviews.map(r => r.total_due),
                        backgroundColor: alpha(COLORS.amber, 0.65),
                        hoverBackgroundColor: COLORS.amber,
                        borderRadius: 3,
                        borderSkipped: false,
                    },
                    {
                        label: 'Done',
                        data: DATA.reviews.map(r => r.total_done),
                        backgroundColor: alpha(COLORS.green, 0.65),
                        hoverBackgroundColor: COLORS.green,
                        borderRadius: 3,
                        borderSkipped: false,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                barPercentage: 0.85,
                categoryPercentage: 0.8,
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8, font: { size: 10 } } },
                    y: { beginAtZero: true }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                const rate = DATA.reviews[idx].completion_rate;
                                return `Completion: ${rate}%`;
                            }
                        }
                    }
                }
            }
        });
    }

    function chartCompletion() {
        const ctx = document.getElementById('canvasCompletion').getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: DATA.weeks,
                datasets: [
                    {
                        label: 'Completion Rate %',
                        data: DATA.reviews.map(r => r.completion_rate),
                        borderColor: COLORS.green,
                        backgroundColor: gradient(ctx, COLORS.green, COLORS.cyan),
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointBackgroundColor: COLORS.green,
                        pointBorderColor: '#0a0a1a',
                        pointBorderWidth: 1.5,
                        pointRadius: 3,
                        pointHoverRadius: 7,
                    },
                    {
                        label: '100% Target',
                        data: DATA.weeks.map(() => 100),
                        borderColor: alpha(COLORS.amber, 0.5),
                        borderWidth: 2,
                        borderDash: [8, 4],
                        pointRadius: 0,
                        fill: false,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8, font: { size: 10 } } },
                    y: { beginAtZero: true, suggestedMax: 160 }
                }
            }
        });
    }

    function chartKPIs() {
        const ctx = document.getElementById('canvasKPIs').getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: DATA.weeks,
                datasets: [
                    {
                        label: 'Critical over SLA',
                        data: DATA.reviews.map(r => r.critical_over_sla),
                        borderColor: COLORS.red,
                        backgroundColor: alpha(COLORS.red, 0.08),
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointBackgroundColor: COLORS.red,
                        pointBorderColor: '#0a0a1a',
                        pointBorderWidth: 1.5,
                        pointRadius: 3,
                        pointHoverRadius: 7,
                    },
                    {
                        label: 'Returned',
                        data: DATA.reviews.map(r => r.returned),
                        borderColor: COLORS.amber,
                        backgroundColor: alpha(COLORS.amber, 0.06),
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointBackgroundColor: COLORS.amber,
                        pointBorderColor: '#0a0a1a',
                        pointBorderWidth: 1.5,
                        pointRadius: 3,
                        pointHoverRadius: 7,
                    },
                    {
                        label: 'Repeating',
                        data: DATA.reviews.map(r => parseInt(r.repeating) || 0),
                        borderColor: COLORS.purple,
                        backgroundColor: alpha(COLORS.purple, 0.06),
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointBackgroundColor: COLORS.purple,
                        pointBorderColor: '#0a0a1a',
                        pointBorderWidth: 1.5,
                        pointRadius: 3,
                        pointHoverRadius: 7,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8, font: { size: 10 } } },
                    y: { beginAtZero: true }
                }
            }
        });
    }

    function chartPlanning() {
        const ctx = document.getElementById('canvasPlanning').getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: DATA.weeks,
                datasets: [
                    {
                        label: 'Planned Hours',
                        data: DATA.reviews.map(r => r.planned_hrs),
                        backgroundColor: alpha(COLORS.blue, 0.65),
                        hoverBackgroundColor: COLORS.blue,
                        borderRadius: 3,
                        borderSkipped: false,
                        order: 2,
                    },
                    {
                        label: 'Created Estimate',
                        data: DATA.reviews.map(r => r.created_est_hrs),
                        backgroundColor: alpha(COLORS.teal, 0.55),
                        hoverBackgroundColor: COLORS.teal,
                        borderRadius: 3,
                        borderSkipped: false,
                        order: 3,
                    },
                    {
                        label: 'Debt Hours',
                        type: 'line',
                        data: DATA.reviews.map(r => r.debt_hrs),
                        borderColor: COLORS.red,
                        backgroundColor: alpha(COLORS.red, 0.1),
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointBackgroundColor: COLORS.red,
                        pointBorderColor: '#0a0a1a',
                        pointBorderWidth: 1.5,
                        pointRadius: 3,
                        pointHoverRadius: 7,
                        order: 1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                barPercentage: 0.85,
                categoryPercentage: 0.8,
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8, font: { size: 10 } } },
                    y: { beginAtZero: true, title: { display: true, text: 'Hours' } }
                }
            }
        });
    }

    // ── Comparison ──────────────────────────────────────────
    function renderComparison() {
        const idxA = parseInt(document.getElementById('compareA').value);
        const idxB = parseInt(document.getElementById('compareB').value);

        if (isNaN(idxA) || isNaN(idxB)) return;

        const a = DATA.reviews[idxA];
        const b = DATA.reviews[idxB];
        if (!a || !b) return;

        const metrics = [
            { label: 'Total Tasks', keyA: a.total_tasks, keyB: b.total_tasks },
            { label: 'Auto Tasks', keyA: a.auto_tasks, keyB: b.auto_tasks },
            { label: 'Data Tasks', keyA: a.data_tasks, keyB: b.data_tasks },
            { label: 'Total Due', keyA: a.total_due, keyB: b.total_due },
            { label: 'Total Done', keyA: a.total_done, keyB: b.total_done },
            { label: 'Completion %', keyA: a.completion_rate, keyB: b.completion_rate, isFloat: true, suffix: '%' },
            { label: 'Critical SLA', keyA: a.critical_over_sla, keyB: b.critical_over_sla, invert: true },
            { label: 'Returned', keyA: a.returned, keyB: b.returned, invert: true },
            { label: 'Planned Hrs', keyA: a.planned_hrs, keyB: b.planned_hrs, isFloat: true, suffix: 'h' },
            { label: 'Debt Hrs', keyA: a.debt_hrs, keyB: b.debt_hrs, isFloat: true, suffix: 'h', invert: true },
        ];

        const grid = document.getElementById('comparisonGrid');
        grid.innerHTML = '';

        metrics.forEach(m => {
            const diff = m.keyA - m.keyB;
            const isUp = diff > 0;
            const isNeutral = diff === 0;
            let arrow = '→';
            if (!isNeutral) {
                if (m.invert) {
                    arrow = isUp ? '🔴' : '🟢';
                } else {
                    arrow = isUp ? '🟢' : '🔴';
                }
            }

            const fmt = (v) => m.isFloat ? v.toFixed(1) : v;
            const suf = m.suffix || '';

            const card = document.createElement('div');
            card.className = 'comparison__metric';
            card.innerHTML = `
        <div class="comparison__metric-label">${m.label}</div>
        <div class="comparison__metric-values">
          <span class="comparison__metric-val comparison__metric-val--a">${fmt(m.keyA)}${suf}</span>
          <span class="comparison__metric-arrow">${arrow}</span>
          <span class="comparison__metric-val comparison__metric-val--b">${fmt(m.keyB)}${suf}</span>
        </div>
      `;
            grid.appendChild(card);
        });
    }

    // ── Events ──────────────────────────────────────────────
    function bindEvents() {
        // Week selector changes
        document.getElementById('weekSelector').addEventListener('change', (e) => {
            selectedWeekIdx = parseInt(e.target.value);
            renderKPIs();
            highlightWeek(selectedWeekIdx);
        });

        // KPI card click → scroll to chart
        document.querySelectorAll('.kpi-card[data-scroll-to]').forEach(card => {
            card.addEventListener('click', () => {
                const target = document.getElementById(card.dataset.scrollTo);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });

        // Comparison selectors
        document.getElementById('compareA').addEventListener('change', renderComparison);
        document.getElementById('compareB').addEventListener('change', renderComparison);
    }

    function highlightWeek(idx) {
        // Highlight the selected week bar in all charts
        Object.values(charts).forEach(chart => {
            if (chart.data && chart.data.datasets) {
                chart.data.datasets.forEach(ds => {
                    if (ds.type === 'line' || chart.config.type === 'line') return;
                    // Store original background colors
                    if (!ds._origBg) ds._origBg = ds.backgroundColor;
                    if (typeof ds.backgroundColor === 'string') {
                        ds.backgroundColor = DATA.weeks.map((_, i) =>
                            i === idx ? ds.hoverBackgroundColor || ds._origBg : ds._origBg
                        );
                    }
                });
                chart.update('none');
            }
        });
    }

    function updateLastUpdated() {
        const el = document.getElementById('lastUpdated');
        if (DATA.lastUpdated) {
            const d = new Date(DATA.lastUpdated);
            el.textContent = `Updated: ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        }
    }

})();

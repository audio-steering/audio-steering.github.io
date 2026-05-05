// Audio steering UI: per-concept section. A pool of HTMLAudioElement
// instances (one per (method, alpha)) is preloaded so the slider can
// hot-swap between them without any load()/decode latency.

const ALPHAS = [-3, -2, -1, 0, 1, 2, 3];

function alphaToken(alpha) {
    if (alpha === 0) return '0';
    // Filenames use a literal '+' for positive alphas (e.g. alpha_+1.mp3).
    return alpha > 0 ? `%2B${alpha}` : `${alpha}`;
}

// methodFolder is the full directory name on disk, e.g. "AUSteer_tf6tf7" or "CAA_all".
function srcFor(example, methodFolder, alpha) {
    return `static/audio_v2/${example}/${methodFolder}/alpha_${alphaToken(alpha)}.mp3`;
}

// Display names for each method (folder-name root -> human label).
const METHOD_DISPLAY_NAME = {
    PI: 'PCI',
    TextEmb: 'Text Emb.',
    TokEmb: 'Token Emb.',
    CS: 'Concept Sliders',
    FreeSliders: 'FreeSliders',
    AUSteer: 'AUSteer',
    CAA: 'CAA',
    SAE: 'SAE',
};

// "AUSteer_tf6tf7" -> "AUSteer (loc.)"; "PI_all" -> "PCI (all)".
function methodLabel(folder) {
    const idx = folder.lastIndexOf('_');
    if (idx < 0) return folder;
    const name = folder.slice(0, idx);
    const variant = folder.slice(idx + 1);
    const display = METHOD_DISPLAY_NAME[name] || name;
    if (variant === 'tf6tf7') return `${display} (loc.)`;
    if (variant === 'all')    return `${display} (all)`;
    return `${display} (${variant})`;
}

function fmtTime(t) {
    if (!isFinite(t) || t < 0) return '0:00';
    const s = Math.floor(t);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PLAY_SVG  = '<svg class="player-icon is-play"  viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg class="player-icon is-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';

// Map slider integer position (the underlying file alpha) -> user-facing label.
// Files exist for alpha ∈ {-3,-2,-1,0,+1,+2,+3}; we relabel them as
// fractions in the range [-1, +1] for display.
const ALPHA_LABEL = {
    [-3]: '-1',
    [-2]: '-2/3',
    [-1]: '-1/3',
    [0]:  '0',
    [1]:  '+1/3',
    [2]:  '+2/3',
    [3]:  '+1',
};
function alphaLabel(a) { return ALPHA_LABEL[a] ?? String(a); }

function initSteerSection(section) {
    const select = section.querySelector('.example-select');
    const promptEl = section.querySelector('.current-prompt');
    const statusEl = section.querySelector('.status-pill');
    const methodRows = Array.from(section.querySelectorAll('.method-row'));
    const playBtn = section.querySelector('.player-play-btn');
    playBtn.innerHTML = PLAY_SVG; // own the icon (avoid FontAwesome SVG-JS replacement issues)
    const progress = section.querySelector('.player-progress');
    const fill = section.querySelector('.player-progress-fill');
    const thumb = section.querySelector('.player-progress-thumb');
    const tCur = section.querySelector('.time-current');
    const tTot = section.querySelector('.time-total');

    // --- pool: key `${method}:${alpha}` -> HTMLAudioElement ---
    let pool = new Map();
    let active = null;          // currently-bound HTMLAudioElement
    let detach = () => {};      // detach UI handlers from previous active

    function getAudio(example, method, alpha) {
        const key = `${method}:${alpha}`;
        let a = pool.get(key);
        if (!a) {
            a = new Audio();
            a.preload = 'auto';
            a.loop = true;
            a.src = srcFor(example, method, alpha);
            pool.set(key, a);
        }
        return a;
    }

    function preloadAlphas(example, method) {
        for (const al of ALPHAS) getAudio(example, method, al);
    }

    function clearPool() {
        pool.forEach(a => { try { a.pause(); } catch (_) {} a.src = ''; });
        pool.clear();
    }

    // --- UI helpers ---
    function setIcon(playing) {
        playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    }
    function setProgress(c, d) {
        const pct = d > 0 ? Math.max(0, Math.min(100, (c / d) * 100)) : 0;
        fill.style.width = pct + '%';
        thumb.style.left = pct + '%';
    }

    // Bind player UI to a specific audio element. Detaches from the previous one.
    function bindUI(a) {
        detach();
        const onPlay = () => setIcon(true);
        const onPause = () => setIcon(false);
        const onTime = () => { setProgress(a.currentTime, a.duration); tCur.textContent = fmtTime(a.currentTime); };
        const onMeta = () => { tTot.textContent = fmtTime(a.duration); setProgress(a.currentTime, a.duration); };
        a.addEventListener('play', onPlay);
        a.addEventListener('pause', onPause);
        a.addEventListener('timeupdate', onTime);
        a.addEventListener('loadedmetadata', onMeta);
        detach = () => {
            a.removeEventListener('play', onPlay);
            a.removeEventListener('pause', onPause);
            a.removeEventListener('timeupdate', onTime);
            a.removeEventListener('loadedmetadata', onMeta);
        };
        // sync UI to this audio's current state
        setIcon(!a.paused);
        setProgress(a.currentTime, a.duration);
        tCur.textContent = fmtTime(a.currentTime);
        tTot.textContent = fmtTime(a.duration);
    }

    // Switch which pool audio is the active one, preserving playback position.
    function switchTo(method, alpha) {
        const next = getAudio(state.example, method, alpha);
        if (active && active !== next) {
            const t = active.currentTime;
            const wasPlaying = !active.paused;
            try { active.pause(); } catch (_) {}
            try {
                if (isFinite(t)) next.currentTime = Math.min(t, next.duration || t);
            } catch (_) {}
            if (wasPlaying) next.play().catch(() => {});
        }
        active = next;
        bindUI(next);
    }

    // --- state ---
    const state = {
        example: select.value,
        activeMethod: null, // null = baseline (alpha=0)
    };

    function currentAlpha(method) {
        const row = methodRows.find(r => r.dataset.method === method);
        return parseInt(row.querySelector('.alpha-slider').value, 10);
    }

    function updateStatusPill() {
        if (state.activeMethod === null) {
            statusEl.innerHTML = 'Baseline &middot; &alpha; = 0';
        } else {
            const a = currentAlpha(state.activeMethod);
            statusEl.innerHTML = `${methodLabel(state.activeMethod)} &middot; &alpha; = ${alphaLabel(a)}`;
        }
    }

    function applyMethod(method) {
        state.activeMethod = method;
        methodRows.forEach(r => {
            r.classList.toggle('active', r.dataset.method === method);
        });
        preloadAlphas(state.example, method); // warm cache
        switchTo(method, currentAlpha(method));
        updateStatusPill();
    }

    function resetToBaseline() {
        state.activeMethod = null;
        methodRows.forEach(r => {
            r.classList.remove('active');
            r.querySelector('.alpha-slider').value = '0';
            r.querySelector('.alpha-display').innerHTML = '&alpha; = 0';
        });
        // alpha=0 is identical across methods — use AUSteer_tf6tf7's α=0 as baseline
        switchTo('AUSteer_tf6tf7', 0);
        updateStatusPill();
    }

    function setPromptFromSelect() {
        const opt = select.options[select.selectedIndex];
        promptEl.textContent = opt.dataset.prompt || opt.textContent;
    }

    // --- player controls (operate on whichever audio is currently `active`) ---
    playBtn.addEventListener('click', () => {
        if (!active) return;
        if (active.paused) active.play().catch(() => {});
        else active.pause();
    });

    function seekFromEvent(e) {
        if (!active) return;
        const rect = progress.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        if (isFinite(active.duration) && active.duration > 0) {
            active.currentTime = ratio * active.duration;
            setProgress(active.currentTime, active.duration);
        }
    }
    let dragging = false;
    const onMove = (e) => { if (dragging) seekFromEvent(e); };
    const onUp = () => { dragging = false; progress.classList.remove('is-dragging'); };
    progress.addEventListener('mousedown', (e) => { dragging = true; progress.classList.add('is-dragging'); seekFromEvent(e); });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    progress.addEventListener('touchstart', (e) => { dragging = true; progress.classList.add('is-dragging'); seekFromEvent(e); }, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
    progress.addEventListener('keydown', (e) => {
        if (!active || !isFinite(active.duration) || active.duration <= 0) return;
        const step = e.shiftKey ? 5 : 2;
        if (e.key === 'ArrowRight') { active.currentTime = Math.min(active.duration, active.currentTime + step); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { active.currentTime = Math.max(0, active.currentTime - step); e.preventDefault(); }
        else if (e.key === ' ' || e.key === 'Enter') {
            if (active.paused) active.play().catch(() => {});
            else active.pause();
            e.preventDefault();
        }
    });

    // --- wire selection + method controls ---
    select.addEventListener('change', () => {
        state.example = select.value;
        clearPool();
        active = null;
        detach = () => {};
        setPromptFromSelect();
        resetToBaseline();
    });

    methodRows.forEach(row => {
        const slider = row.querySelector('.alpha-slider');
        const display = row.querySelector('.alpha-display');
        // Read data-method dynamically; the baseline row may change it on the fly.
        const methodOf = () => row.dataset.method;

        // Mark this method active as soon as the user touches its slider,
        // even before the value actually changes.
        slider.addEventListener('pointerdown', () => {
            const method = methodOf();
            if (state.activeMethod !== method) applyMethod(method);
            if (active && active.paused) active.play().catch(() => {});
        });

        slider.addEventListener('input', () => {
            const method = methodOf();
            const a = parseInt(slider.value, 10);
            display.innerHTML = `&alpha; = ${alphaLabel(a)}`;
            if (state.activeMethod !== method) applyMethod(method);
            switchTo(method, a);
            updateStatusPill();
            if (active && active.paused) active.play().catch(() => {});
        });
    });

    // Baseline row: change which method this row points at.
    const baselineRow = section.querySelector('.method-row-baseline');
    if (baselineRow) {
        const baselineSelect = baselineRow.querySelector('.baseline-select');
        // Clicking the dropdown shouldn't pretend the user touched the slider.
        baselineSelect.addEventListener('pointerdown', e => e.stopPropagation());
        baselineSelect.addEventListener('click', e => e.stopPropagation());

        baselineSelect.addEventListener('change', () => {
            const newMethod = baselineSelect.value;
            const wasActive = baselineRow.classList.contains('active');
            baselineRow.dataset.method = newMethod;
            preloadAlphas(state.example, newMethod);
            if (wasActive) {
                applyMethod(newMethod); // re-route audio to the new baseline at current alpha
                if (active && active.paused) active.play().catch(() => {});
            }
        });
    }

    // --- initial render ---
    setPromptFromSelect();
    resetToBaseline();
}

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.steer-section').forEach(initSteerSection);
});

// Scroll to top
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.addEventListener('scroll', function() {
    var scrollButton = document.querySelector('.scroll-to-top');
    if (!scrollButton) return;
    if (window.pageYOffset > 300) scrollButton.classList.add('visible');
    else scrollButton.classList.remove('visible');
});

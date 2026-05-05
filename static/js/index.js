// Audio steering UI driven by the Web Audio API.
//
// For each section there is a per-section "engine" that:
//   - keeps a decoded-AudioBuffer cache keyed by (example, method);
//   - while a method is "active", runs 7 looping AudioBufferSourceNodes
//     (one per α) through 7 per-α GainNodes into a master GainNode.
//   - alpha changes -> smooth gain ramp across the 7 sources (no restart).
//   - method changes -> a brief master-gain crossfade between the
//     old and new source graphs, both phase-aligned via a shared offset.

// ---------- shared constants ----------

const ALPHAS = [-3, -2, -1, 0, 1, 2, 3];

function alphaToken(alpha) {
    if (alpha === 0) return '0';
    return alpha > 0 ? `%2B${alpha}` : `${alpha}`;
}
function srcFor(example, methodFolder, alpha) {
    return `static/audio_v2/${example}/${methodFolder}/alpha_${alphaToken(alpha)}.mp3`;
}

const METHOD_DISPLAY_NAME = {
    PI: 'PCI', TextEmb: 'Text Emb.', TokEmb: 'Token Emb.',
    CS: 'Concept Sliders', FreeSliders: 'FreeSliders',
    AUSteer: 'AUSteer', CAA: 'CAA', SAE: 'SAE',
};
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

const ALPHA_LABEL = {
    [-3]: '-1', [-2]: '-2/3', [-1]: '-1/3', [0]: '0',
    [1]: '+1/3', [2]: '+2/3', [3]: '+1',
};
function alphaLabel(a) { return ALPHA_LABEL[a] ?? String(a); }

function fmtTime(t) {
    if (!isFinite(t) || t < 0) return '0:00';
    const s = Math.floor(t);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PLAY_SVG  = '<svg class="player-icon is-play"  viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg class="player-icon is-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';

// One AudioContext per page, lazily created.
let _ctx = null;
function audioCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
}

// alpha integer -3..+3 -> index 0..6 into ALPHAS / buffer array
function alphaToIdx(a) { return a + 3; }

// ---------- per-section engine ----------

function createEngine() {
    const buffers = new Map();   // "${example}:${method}" -> AudioBuffer[7]
    const inflight = new Map();  // same key -> Promise<AudioBuffer[]>

    // `active` describes the current method. When `graph` is non-null, the 7
    // sources are running and `startCtxTime` says when they were started.
    // When `graph` is null, the method is "parked" (paused) and `offset`
    // says where the next play() should resume from.
    //
    // {
    //   method:        string,
    //   bufs:          AudioBuffer[7],
    //   duration:      number,           // seconds
    //   alphaIdx:      number,           // 0..6
    //   offset:        number,           // seconds, only meaningful while paused
    //   startCtxTime:  number,           // AudioContext clock when sources started
    //   graph:         { sources, alphaGains, master } | null,
    // }
    let active = null;
    let isPlaying = false;
    let activeExample = null;

    function key(example, method) { return `${example}:${method}`; }

    async function loadMethod(example, method) {
        const k = key(example, method);
        if (buffers.has(k)) return buffers.get(k);
        if (inflight.has(k)) return inflight.get(k);
        const ctx = audioCtx();
        const p = (async () => {
            const bufs = await Promise.all(ALPHAS.map(async (a) => {
                const resp = await fetch(srcFor(example, method, a));
                if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${resp.url}`);
                const ab = await resp.arrayBuffer();
                return await ctx.decodeAudioData(ab);
            }));
            buffers.set(k, bufs);
            inflight.delete(k);
            return bufs;
        })();
        inflight.set(k, p);
        return p;
    }

    function buildGraph(bufs, alphaIdx, offset, startCtxTime, initialMasterGain) {
        const ctx = audioCtx();
        const master = ctx.createGain();
        master.gain.value = initialMasterGain;
        master.connect(ctx.destination);
        const alphaGains = bufs.map((_, i) => {
            const g = ctx.createGain();
            g.gain.value = (i === alphaIdx) ? 1 : 0;
            g.connect(master);
            return g;
        });
        const sources = bufs.map((buf, i) => {
            const s = ctx.createBufferSource();
            s.buffer = buf;
            s.loop = true;
            s.connect(alphaGains[i]);
            return s;
        });
        const dur = bufs[0].duration;
        const startOffset = ((offset % dur) + dur) % dur;
        for (const s of sources) s.start(startCtxTime, startOffset);
        return { sources, alphaGains, master };
    }

    function teardownGraphAt(graph, atCtxTime) {
        if (!graph) return;
        const ctx = audioCtx();
        const delayMs = Math.max(0, (atCtxTime - ctx.currentTime) * 1000) + 50;
        setTimeout(() => {
            for (const s of graph.sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
            for (const g of graph.alphaGains) { try { g.disconnect(); } catch {} }
            try { graph.master.disconnect(); } catch {}
        }, delayMs);
    }

    function applyAlphaGains() {
        if (!active || !active.graph) return;
        const ctx = audioCtx();
        const now = ctx.currentTime;
        const tc = 0.015; // ~15 ms time-constant α crossfade
        active.graph.alphaGains.forEach((g, i) => {
            g.gain.setTargetAtTime(i === active.alphaIdx ? 1 : 0, now, tc);
        });
    }

    function currentOffset() {
        if (!active) return 0;
        if (!active.graph) return active.offset;
        const ctx = audioCtx();
        const elapsed = Math.max(0, ctx.currentTime - active.startCtxTime);
        return (active.offset + elapsed) % active.duration;
    }

    async function activate(example, method, alphaIdx) {
        const ctx = audioCtx();
        if (ctx.state === 'suspended') await ctx.resume();

        // Same method already active: just crossfade α.
        if (active && active.method === method) {
            active.alphaIdx = alphaIdx;
            applyAlphaGains();
            return;
        }

        const bufs = await loadMethod(example, method);
        const duration = bufs[0].duration;

        if (!isPlaying) {
            // Park the method — no live graph yet. play() will build one.
            if (active && active.graph) teardownGraphAt(active.graph, ctx.currentTime);
            active = { method, bufs, duration, alphaIdx, offset: 0, startCtxTime: 0, graph: null };
            return;
        }

        // Currently playing some other method: do an aligned crossfade.
        const fadeS = 0.05;
        const now = ctx.currentTime;
        const switchAt = now + 0.02;
        // Where the old graph will be when the new one starts:
        const offAtSwitch = (active.offset + (switchAt - active.startCtxTime)) % active.duration;

        const oldGraph = active.graph;
        oldGraph.master.gain.cancelScheduledValues(now);
        oldGraph.master.gain.setValueAtTime(oldGraph.master.gain.value, now);
        oldGraph.master.gain.linearRampToValueAtTime(0, switchAt + fadeS);
        teardownGraphAt(oldGraph, switchAt + fadeS);

        const newGraph = buildGraph(bufs, alphaIdx, offAtSwitch, switchAt, 0);
        newGraph.master.gain.setValueAtTime(0, switchAt);
        newGraph.master.gain.linearRampToValueAtTime(1, switchAt + fadeS);

        active = { method, bufs, duration, alphaIdx, offset: offAtSwitch, startCtxTime: switchAt, graph: newGraph };
    }

    async function play() {
        const ctx = audioCtx();
        if (ctx.state === 'suspended') await ctx.resume();
        if (!active || isPlaying) return;
        const startAt = ctx.currentTime + 0.02;
        const graph = buildGraph(active.bufs, active.alphaIdx, active.offset, startAt, 1);
        active.graph = graph;
        active.startCtxTime = startAt;
        isPlaying = true;
    }

    function pause() {
        if (!active || !isPlaying) return;
        const off = currentOffset();
        teardownGraphAt(active.graph, audioCtx().currentTime);
        active.graph = null;
        active.offset = off;
        isPlaying = false;
    }

    function setAlpha(alphaIdx) {
        if (!active) return;
        active.alphaIdx = alphaIdx;
        applyAlphaGains();
    }

    function seek(offset) {
        if (!active) return;
        const off = Math.max(0, Math.min(active.duration, offset));
        if (active.graph) {
            // Rebuild graph at the new offset to "seek".
            teardownGraphAt(active.graph, audioCtx().currentTime);
            const startAt = audioCtx().currentTime + 0.02;
            active.graph = buildGraph(active.bufs, active.alphaIdx, off, startAt, 1);
            active.startCtxTime = startAt;
            active.offset = off;
        } else {
            active.offset = off;
        }
    }

    function resetAll() {
        if (active && active.graph) teardownGraphAt(active.graph, audioCtx().currentTime);
        active = null;
        isPlaying = false;
        buffers.clear();
        inflight.clear();
    }

    function setExample(ex) { activeExample = ex; }

    return {
        loadMethod, activate, play, pause, setAlpha, seek, resetAll, setExample,
        currentOffset, get isPlaying() { return isPlaying; },
        get active() { return active; },
    };
}

// ---------- per-section UI wiring ----------

function initSteerSection(section) {
    const select = section.querySelector('.example-select');
    const promptEl = section.querySelector('.current-prompt');
    const statusEl = section.querySelector('.status-pill');
    const methodRows = Array.from(section.querySelectorAll('.method-row'));
    const playBtn = section.querySelector('.player-play-btn');
    playBtn.innerHTML = PLAY_SVG;
    const progress = section.querySelector('.player-progress');
    const fill = section.querySelector('.player-progress-fill');
    const thumb = section.querySelector('.player-progress-thumb');
    const tCur = section.querySelector('.time-current');
    const tTot = section.querySelector('.time-total');

    const engine = createEngine();
    let rafHandle = null;

    const state = {
        example: select.value,
        activeMethod: null,
    };
    engine.setExample(state.example);

    // ---- UI helpers ----
    function setIcon(playing) {
        playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    }
    function setProgress(c, d) {
        const pct = d > 0 ? Math.max(0, Math.min(100, (c / d) * 100)) : 0;
        fill.style.width = pct + '%';
        thumb.style.left = pct + '%';
    }
    function updateTime() {
        const a = engine.active;
        const d = a ? (a.duration || 0) : 0;
        const c = engine.currentOffset();
        tTot.textContent = fmtTime(d);
        tCur.textContent = fmtTime(c);
        setProgress(c, d);
    }
    function startRAF() {
        if (rafHandle) return;
        const tick = () => {
            if (!engine.isPlaying) { rafHandle = null; return; }
            updateTime();
            rafHandle = requestAnimationFrame(tick);
        };
        rafHandle = requestAnimationFrame(tick);
    }
    function stopRAF() {
        if (rafHandle) cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }

    function currentAlphaOf(method) {
        const row = methodRows.find(r => r.dataset.method === method);
        return parseInt(row.querySelector('.alpha-slider').value, 10);
    }
    function updateStatusPill() {
        if (state.activeMethod === null) {
            statusEl.innerHTML = 'Baseline &middot; &alpha; = 0';
        } else {
            const a = currentAlphaOf(state.activeMethod);
            statusEl.innerHTML = `${methodLabel(state.activeMethod)} &middot; &alpha; = ${alphaLabel(a)}`;
        }
    }
    function setActiveRow(method) {
        state.activeMethod = method;
        methodRows.forEach(r => r.classList.toggle('active', r.dataset.method === method));
        updateStatusPill();
    }

    function setPromptFromSelect() {
        const opt = select.options[select.selectedIndex];
        promptEl.textContent = opt.dataset.prompt || opt.textContent;
    }

    function resetToBaseline() {
        state.activeMethod = null;
        methodRows.forEach(r => {
            r.classList.remove('active');
            r.querySelector('.alpha-slider').value = '0';
            r.querySelector('.alpha-display').innerHTML = '&alpha; = 0';
        });
        engine.resetAll();
        engine.setExample(state.example);
        updateStatusPill();
        updateTime();
        setIcon(false);
    }

    // ---- main player controls ----
    playBtn.addEventListener('click', async () => {
        if (engine.isPlaying) {
            engine.pause();
            setIcon(false);
            stopRAF();
            updateTime();
        } else {
            // If no method has been touched yet, default to the baseline row's method at α=0.
            if (!state.activeMethod) {
                const defaultRow = methodRows[0];
                const m = defaultRow.dataset.method;
                setActiveRow(m);
                await engine.activate(state.example, m, alphaToIdx(0));
            }
            await engine.play();
            setIcon(true);
            startRAF();
        }
    });

    // Seek bar (no-op until a method has been activated)
    function seekFromEvent(e) {
        const a = engine.active;
        if (!a || !a.duration) return;
        const rect = progress.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        engine.seek(ratio * a.duration);
        if (engine.isPlaying) startRAF();
        updateTime();
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

    // ---- example picker ----
    select.addEventListener('change', () => {
        state.example = select.value;
        setPromptFromSelect();
        resetToBaseline();
    });

    // ---- method rows ----
    methodRows.forEach(row => {
        const slider = row.querySelector('.alpha-slider');
        const display = row.querySelector('.alpha-display');
        const methodOf = () => row.dataset.method;

        async function touchSlider() {
            const method = methodOf();
            const a = parseInt(slider.value, 10);
            display.innerHTML = `&alpha; = ${alphaLabel(a)}`;
            if (state.activeMethod !== method) {
                setActiveRow(method);
                await engine.activate(state.example, method, alphaToIdx(a));
                if (!engine.isPlaying) {
                    await engine.play();
                    setIcon(true);
                    startRAF();
                }
            } else {
                engine.setAlpha(alphaToIdx(a));
                updateStatusPill();
            }
        }

        slider.addEventListener('pointerdown', () => { touchSlider(); });
        slider.addEventListener('input', () => { touchSlider(); });
    });

    // ---- baseline-row method picker ----
    const baselineRow = section.querySelector('.method-row-baseline');
    if (baselineRow) {
        const baselineSelect = baselineRow.querySelector('.baseline-select');
        baselineSelect.addEventListener('pointerdown', e => e.stopPropagation());
        baselineSelect.addEventListener('click', e => e.stopPropagation());
        baselineSelect.addEventListener('change', async () => {
            const newMethod = baselineSelect.value;
            const wasActive = baselineRow.classList.contains('active');
            baselineRow.dataset.method = newMethod;
            // Pre-warm the new buffers so the next interaction is instant.
            engine.loadMethod(state.example, newMethod).catch(() => {});
            if (wasActive) {
                const a = parseInt(baselineRow.querySelector('.alpha-slider').value, 10);
                setActiveRow(newMethod);
                await engine.activate(state.example, newMethod, alphaToIdx(a));
                if (!engine.isPlaying) {
                    await engine.play();
                    setIcon(true);
                    startRAF();
                }
            }
        });
    }

    // ---- initial render ----
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

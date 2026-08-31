<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gsap } from 'gsap';
  import type { Song, AudioVisualizer } from '../lib/types';
  import { initLiquidGlass } from '../lib/effects/liquidGlass';
  import { config } from '../lib/config';
  import { pageLoad } from '../lib/loading';

  export let visualizer: AudioVisualizer;

  export let song: Song | null = null;
  export let loading = false;
  export let canPrev = false;
  export let canNext = false;
  export let onPrev: () => void = () => {};
  export let onNext: () => void = () => {};
  
  export let enter = false;

  let cardEl: HTMLDivElement;
  let coverEl: HTMLImageElement;
  let metaEl: HTMLDivElement;
  let titleEl: HTMLHeadingElement;
  let artistEl: HTMLParagraphElement;
  let miniPlayEl: HTMLButtonElement;
  let collapseEl: HTMLButtonElement;
  let extraEl: HTMLDivElement;
  let fillEl: HTMLDivElement;
  let knobEl: HTMLDivElement;
  let currentEl: HTMLSpanElement;
  let durationEl: HTMLSpanElement;
  let trackEl: HTMLDivElement;
  let playPauseEl: HTMLButtonElement;

  let isExpanded = false;
  let playing = false;
  let currentPct = 0;
  let audio!: HTMLAudioElement;
  let liquidGlass: any;
  let tl: gsap.core.Timeline | null = null;
  let idleTl: gsap.core.Timeline | null = null;
  let entranceTweens: gsap.core.Animation[] = [];

  let miniW = 0;
  let expandW = 0;
  let miniH = 0;
  let expandedH = 0;
  let contentW = 0;
  let coverH = 0;
  let coverMiniTop = 0;
  let metaMiniLeft = 0;
  let metaMiniTop = 0;
  let metaMiniW = 0;
  let playMiniLeft = 0;
  let playMiniTop = 0;
  let coverExpandTop = 0;
  let metaExpandTop = 0;
  let metaExpandW = 0;

  const PR = config.player;

  const PAD_X_MINI = 14;
  const PAD_Y_MINI = 10;
  const PAD_X_EXPAND = 22;
  const PAD_Y_EXPAND = 20;
  const MINI_COVER = 48;
  const COVER_GAP = 12;
  const PLAY_GAP = 12;
  const MINI_PLAY = 40;
  const COLLAPSE_H = 24;
  const GAP = 18;
  const META_H_MINI = 37;
  const META_H_EXPAND = 46;
  const EXTRA_H = 82;
  const FONT_TITLE_MINI = 15;
  const FONT_TITLE_EXPAND = 20;
  const FONT_ARTIST_MINI = 12;
  const FONT_ARTIST_EXPAND = 14;

  const EASE_SPRING = 'back.out(1.6)';
  const EASE_GLASS = 'elastic.out(0.45, 0.75)';
  const GLASS_EXPANDED = {
    blurAmount: 0.75,
    refraction: 1.75,
    chromAberration: 0.45,
    edgeHighlight: 0.35,
    brightness: -0.25,
    saturation: 0.25,
  };
  const SHADOW_MINI = '0 4px 14px rgba(0,0,0,0.45)';
  const SHADOW_EXPAND = '0 8px 32px rgba(0,0,0,0.5)';
  const RADIUS_MINI = 10;
  const RADIUS_EXPAND = 14;

  function computeLayouts() {
    miniW = Math.min(380, window.innerWidth * 0.92);
    expandW = Math.min(340, window.innerWidth * 0.85);
    miniH = PAD_Y_MINI * 2 + MINI_COVER;
    contentW = expandW - PAD_X_EXPAND * 2;
    coverH = contentW;
    expandedH = PAD_Y_EXPAND * 2 + COLLAPSE_H + GAP + coverH + GAP + META_H_EXPAND + GAP + EXTRA_H;

    const miniContentW = miniW - PAD_X_MINI * 2;
    const miniContentH = miniH - PAD_Y_MINI * 2;
    coverMiniTop = (miniContentH - MINI_COVER) / 2;
    metaMiniLeft = MINI_COVER + COVER_GAP;
    metaMiniW = miniContentW - MINI_COVER - COVER_GAP - MINI_PLAY - PLAY_GAP;
    metaMiniTop = (miniContentH - META_H_MINI) / 2;
    playMiniLeft = miniContentW - MINI_PLAY;
    playMiniTop = (miniContentH - MINI_PLAY) / 2;

    coverExpandTop = COLLAPSE_H + GAP;
    metaExpandTop = coverExpandTop + coverH + GAP;
    metaExpandW = contentW;
  }

  function setMiniLayout() {
    gsap.set(cardEl, { xPercent: -50, yPercent: 0, width: miniW, height: miniH, padding: `${PAD_Y_MINI}px ${PAD_X_MINI}px`, bottom: '3vh' });
    gsap.set(coverEl, { left: 0, top: coverMiniTop, width: MINI_COVER, height: MINI_COVER, borderRadius: RADIUS_MINI, boxShadow: SHADOW_MINI });
    gsap.set(metaEl, { left: metaMiniLeft, top: metaMiniTop, width: metaMiniW });
    gsap.set(titleEl, { fontSize: FONT_TITLE_MINI });
    gsap.set(artistEl, { fontSize: FONT_ARTIST_MINI });
    gsap.set(miniPlayEl, { left: playMiniLeft, top: playMiniTop, autoAlpha: 1 });
    gsap.set(collapseEl, { autoAlpha: 0 });
    gsap.set(extraEl, { autoAlpha: 0 });
  }

  function setExpandedLayout() {
    gsap.set(cardEl, { xPercent: -50, yPercent: 50, width: expandW, height: expandedH, padding: `${PAD_Y_EXPAND}px ${PAD_X_EXPAND}px`, bottom: '50%' });
    gsap.set(coverEl, { left: 0, top: coverExpandTop, width: coverH, height: coverH, borderRadius: RADIUS_EXPAND, boxShadow: SHADOW_EXPAND });
    gsap.set(metaEl, { left: 0, top: metaExpandTop, width: metaExpandW });
    gsap.set(titleEl, { fontSize: FONT_TITLE_EXPAND });
    gsap.set(artistEl, { fontSize: FONT_ARTIST_EXPAND });
    gsap.set(miniPlayEl, { autoAlpha: 0 });
    gsap.set(collapseEl, { autoAlpha: 1 });
    gsap.set(extraEl, { autoAlpha: 1 });
  }

  function finishGlass() {
    liquidGlass?.setAnimating(false);
  }

  let glassState = { ...config.liquidGlass };
  let glassTween: gsap.core.Tween | null = null;
  let lastGlassApply = 0;

  const GLASS_BASE = { ...config.liquidGlass };

  function applyGlass(force = false) {
    if (!cardEl) return;
    
    
    
    const now = performance.now();
    if (!force && now - lastGlassApply < 16) return;
    lastGlassApply = now;
    let safeState;
    try {
      safeState = {};
      for (const k of Object.keys(glassState)) {
        if (k.startsWith('_')) continue;
        safeState[k] = glassState[k];
      }
      cardEl.dataset.config = JSON.stringify({ ...GLASS_BASE, ...safeState });
    } catch (e) {
      console.error('applyGlass: failed to write data-config', e);
    }
  }

  function forceGlassRefresh() {
    if (!liquidGlass || !cardEl) return;
    if (liquidGlass._glassDirty) liquidGlass._glassDirty.add(cardEl);
  }

  function tweenGlass(target: gsap.TweenVars, duration = 0.55) {
    if (!liquidGlass || !cardEl) return;
    if (glassTween) glassTween.kill();
    glassTween = gsap.to(glassState, {
      ...target,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        applyGlass();
        forceGlassRefresh();
      },
      onComplete: () => {
        applyGlass(true);
        glassTween = null;
        const waitCaptureDone = () => {
          if (liquidGlass?._capturingGlassContent) {
            requestAnimationFrame(waitCaptureDone);
            return;
          }
          forceGlassRefresh();
        };
        requestAnimationFrame(waitCaptureDone);
      },
    });
  }

  function runTimeline(build: (tl: gsap.core.Timeline) => void, onDone?: () => void) {
    if (glassTween) { glassTween.kill(); glassTween = null; }
    if (tl) tl.kill();
    liquidGlass?.setAnimating(true);
    tl = gsap.timeline({
      onComplete: () => {
        tl = null;
        finishGlass();
        onDone?.();
      },
      onInterrupt: finishGlass,
    });
    build(tl);
  }

  function killEntrance() {
    if (!entranceTweens.length) return;
    entranceTweens.forEach((t) => t.kill());
    entranceTweens = [];
    gsap.set(cardEl, { y: 0, scale: 1 });
    gsap.set(coverEl, { x: 0, autoAlpha: 1 });
    gsap.set(metaEl, { x: 0, autoAlpha: 1 });
    gsap.set(miniPlayEl, { scale: 1, autoAlpha: 1 });
  }

  function stopIdle(smooth = false) {
    if (idleTl) {
      idleTl.kill();
      idleTl = null;
    }
    if (smooth) {
      gsap.to(coverEl, { scale: 1, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
    } else {
      gsap.killTweensOf(coverEl, 'scale');
      gsap.set(coverEl, { clearProps: 'scale' });
    }
  }

  function startIdle() {
    stopIdle();
    if (!playing || isExpanded) return;
    const t = gsap.timeline({ repeat: -1 });
    t.to(coverEl, { scale: 1.05, duration: 1.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
    idleTl = t;
  }

  function expandCard() {
    if (isExpanded) {
      if (tl) collapseCard();
      return;
    }
    killEntrance();
    stopIdle();
    isExpanded = true;
    gsap.set(cardEl, { cursor: 'default' });
    runTimeline((t) => {
      const ease = EASE_GLASS;
      tweenGlass(GLASS_EXPANDED, 0.7);
      t.to(cardEl, {
        height: expandedH,
        width: expandW,
        padding: `${PAD_Y_EXPAND}px ${PAD_X_EXPAND}px`,
        bottom: '50%',
        yPercent: 50,
        duration: 0.7,
        ease,
      }, 0);
      t.to(coverEl, {
        left: 0,
        top: coverExpandTop,
        width: coverH,
        height: coverH,
        borderRadius: RADIUS_EXPAND,
        boxShadow: SHADOW_EXPAND,
        duration: 0.7,
        ease,
      }, 0);
      t.to(metaEl, { left: 0, top: metaExpandTop, width: metaExpandW, duration: 0.7, ease }, 0);
      t.to(titleEl, { fontSize: FONT_TITLE_EXPAND, duration: 0.7, ease }, 0);
      t.to(artistEl, { fontSize: FONT_ARTIST_EXPAND, duration: 0.7, ease }, 0);
      t.fromTo(miniPlayEl, { autoAlpha: 1, scale: 1 }, { autoAlpha: 0, scale: 0.6, duration: 0.2, ease: 'power2.out' }, 0);
      t.fromTo(collapseEl, { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, ease: EASE_SPRING }, 0.2);
      t.fromTo(extraEl, { y: 18, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.6, ease: 'power3.out' }, 0.25);
    });
  }

  function collapseCard() {
    if (!isExpanded) {
      if (tl) expandCard();
      return;
    }
    killEntrance();
    stopIdle();
    isExpanded = false;
    gsap.set(cardEl, { cursor: 'pointer' });
    runTimeline((t) => {
      const ease = EASE_GLASS;
      tweenGlass(GLASS_BASE, 0.7);
      t.to(cardEl, {
        height: miniH,
        width: miniW,
        padding: `${PAD_Y_MINI}px ${PAD_X_MINI}px`,
        bottom: '3vh',
        yPercent: 0,
        duration: 0.7,
        ease,
      }, 0);
      t.to(coverEl, {
        left: 0,
        top: coverMiniTop,
        width: MINI_COVER,
        height: MINI_COVER,
        borderRadius: RADIUS_MINI,
        boxShadow: SHADOW_MINI,
        duration: 0.7,
        ease,
      }, 0);
      t.to(metaEl, { left: metaMiniLeft, top: metaMiniTop, width: metaMiniW, duration: 0.7, ease }, 0);
      t.to(titleEl, { fontSize: FONT_TITLE_MINI, duration: 0.7, ease }, 0);
      t.to(artistEl, { fontSize: FONT_ARTIST_MINI, duration: 0.7, ease }, 0);
      t.to(collapseEl, { autoAlpha: 0, y: -6, duration: 0.22, ease: 'power2.in' }, 0);
      t.to(extraEl, { autoAlpha: 0, y: 10, scale: 0.98, duration: 0.22, ease: 'power2.in' }, 0);
      t.fromTo(miniPlayEl, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: EASE_SPRING }, 0.18);
    }, () => {
      if (playing) startIdle();
    });
  }

  function onContentClick(e: MouseEvent) {
    if (isExpanded) return;
    expandCard();
  }

  function onContentKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isExpanded) expandCard();
    }
  }

  function onTrackKey(e: KeyboardEvent) {
    if (!audio.duration) return;
    const step = PR.seekStep;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - step);
    }
  }

  function formatTime(seconds: number): string {
    if (!isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function popPlayBtn(btn: HTMLElement | null) {
    if (!btn) return;
    gsap.fromTo(
      btn,
      { scale: 0.72, rotate: -12 },
      { scale: 1, rotate: 0, duration: 0.4, ease: 'back.out(2.2)', clearProps: 'transform' }
    );
  }

  function togglePlay() {
    if (!audio || !audio.src) return;
    visualizer.ensureGraph();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    popPlayBtn(miniPlayEl);
    popPlayBtn(playPauseEl);
  }

  function updateProgress() {
    if (!audio.duration) return;
    currentPct = (audio.currentTime / audio.duration) * 100;
    fillEl.style.width = currentPct + '%';
    if (knobEl) knobEl.style.left = currentPct + '%';
    currentEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent = '-' + formatTime(audio.duration - audio.currentTime);
  }

  function seekTo(e: MouseEvent) {
    if (!audio.duration) return;
    const rect = trackEl.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  function onDocClick(e: MouseEvent) {
    if (!isExpanded) return;
    if (!cardEl.contains(e.target as Node)) collapseCard();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      togglePlay();
    }
  }

  function onResize() {
    computeLayouts();
    if (tl) {
      tl.kill();
      tl = null;
    }
    finishGlass();
    if (isExpanded) setExpandedLayout();
    else setMiniLayout();
  }

  function entranceY() {
    return miniH + window.innerHeight * 0.03;
  }

  function playEntrance() {
    killEntrance();
    const e = gsap.timeline();
    e.fromTo(cardEl, { y: entranceY() }, { y: 0, duration: 0.7, ease: 'back.out(1.3)' }, 0);
    e.fromTo(coverEl, { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' }, 0.1);
    e.fromTo(metaEl, { x: 14, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' }, 0.16);
    e.fromTo(miniPlayEl, { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2)' }, 0.24);
    entranceTweens = e.getChildren();
  }

  
  $: if (enter) playEntrance();

  onMount(async () => {
    computeLayouts();
    setMiniLayout();
    gsap.set(cardEl, { y: entranceY() });

    window.addEventListener('resize', onResize);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeydown);

    audio = document.getElementById('audio') as HTMLAudioElement;
    audio.loop = PR.loop;
    audio.addEventListener('play', () => {
      playing = true;
      if (audio.currentTime < 0.2) {
        currentPct = 0;
        if (fillEl) fillEl.style.width = '0%';
        if (knobEl) knobEl.style.left = '0%';
        if (currentEl) currentEl.textContent = '0:00';
      }
      if (!isExpanded) startIdle();
    });
    audio.addEventListener('pause', () => {
      playing = false;
      stopIdle(true);
    });
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      durationEl.textContent = '-' + formatTime(audio.duration);
    });

    const glassTask = initLiquidGlass(cardEl, cardEl.parentElement!);
    pageLoad.waitFor('glass', glassTask);
    liquidGlass = await glassTask;
    if (isExpanded) {
      glassState = { ...glassState, ...GLASS_EXPANDED };
      applyGlass();
      forceGlassRefresh();
    }
  });

  onDestroy(() => {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKeydown);
    if (tl) tl.kill();
    stopIdle();
  });
</script>

<div class="player glass" bind:this={cardEl}>
  <div class="pc" role="button" tabindex="0" on:click={onContentClick} on:keydown={onContentKey}>
    <img src={song?.cover || ''} alt="cover" class="pc-cover" bind:this={coverEl} draggable={false} crossorigin="anonymous">

    <div class="pc-meta" bind:this={metaEl}>
      <h3 bind:this={titleEl}>{song?.name || '未在播放'}</h3>
      <p bind:this={artistEl}>{song?.artist || '搜索歌曲开始播放'}</p>
    </div>

    <button class="mini-play" class:playing={playing} class:loading={loading} disabled={!song} bind:this={miniPlayEl} on:click|stopPropagation={togglePlay}>
      <span class="btn-spinner"></span>
      <svg class="icon-play" viewBox="0 0 24 24" width="20" height="20">
        <path d="M8 5v14l11-7z"></path>
      </svg>
      <svg class="icon-pause" viewBox="0 0 24 24" width="20" height="20">
        <rect x="6" y="5" width="4" height="14" rx="1"></rect>
        <rect x="14" y="5" width="4" height="14" rx="1"></rect>
      </svg>
    </button>

    <button class="pc-collapse" bind:this={collapseEl} on:click|stopPropagation={collapseCard} title="收起">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </button>

    <div class="pc-extra" bind:this={extraEl}>
      <div class="progress-bar">
        <div class="progress-track" bind:this={trackEl} role="slider" tabindex="0" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={currentPct} on:click|stopPropagation={seekTo} on:keydown={onTrackKey}>
          <div class="progress-fill" bind:this={fillEl}></div>
        </div>
        <div class="progress-knob" bind:this={knobEl}></div>
        <div class="progress-time">
          <span bind:this={currentEl}>0:00</span>
          <span bind:this={durationEl}>-3:45</span>
        </div>
      </div>
      <div class="expanded-controls">
        <button class="ctrl-btn skip-back" title="上一首" disabled={!canPrev} on:click|stopPropagation={onPrev}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" fill="currentColor"></path>
          </svg>
        </button>
        <button class="ctrl-btn play-pause large" class:playing={playing} class:loading={loading} disabled={!song} bind:this={playPauseEl} on:click|stopPropagation={togglePlay}>
          <span class="btn-spinner"></span>
          <svg class="icon-play" viewBox="0 0 24 24" width="24" height="24">
            <path d="M8 5v14l11-7z"></path>
          </svg>
          <svg class="icon-pause" viewBox="0 0 24 24" width="24" height="24">
            <rect x="6" y="5" width="4" height="14" rx="1"></rect>
            <rect x="14" y="5" width="4" height="14" rx="1"></rect>
          </svg>
        </button>
        <button class="ctrl-btn skip-forward" title="下一首" disabled={!canNext} on:click|stopPropagation={onNext}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" fill="currentColor"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .player {
    position: absolute;
    bottom: 3vh;
    left: 50%;
    width: min(380px, 92vw);
    padding: 10px 14px;
    z-index: 2;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .pc {
    position: relative;
    width: 100%;
    height: 100%;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .pc:focus {
    outline: none;
  }

  .pc-cover {
    position: absolute;
    left: 0;
    top: 0;
    width: 48px;
    height: 48px;
    border-radius: 10px;
    object-fit: cover;
     
    background: linear-gradient(135deg, #232742 0%, #12151f 100%);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    will-change: transform, opacity, filter;
    -webkit-user-drag: none;
  }

  .pc-meta {
    position: absolute;
    text-align: left;
    min-width: 0;
    will-change: transform, opacity;
  }

  .pc-meta h3 {
    font-weight: 600;
    letter-spacing: -0.2px;
    line-height: 1.3;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pc-meta p {
    color: rgba(255, 255, 255, 0.45);
    margin-top: 2px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-play {
    position: absolute;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.35);
    color: #fff;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease;
    line-height: 1;
    flex-shrink: 0;
    backdrop-filter: blur(10px) saturate(1.4) brightness(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.4) brightness(1.2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 0 -6px 12px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.18);
    will-change: transform, opacity;
  }

  .mini-play:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.08);
  }

  .mini-play:active {
    transform: scale(0.94);
  }

  .mini-play:disabled,
  .play-pause:disabled {
    opacity: 0.45;
    cursor: default;
    transform: none;
  }

  .btn-spinner {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: btn-spin 0.7s linear infinite;
    opacity: 0;
    transform: scale(0.4);
    transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    pointer-events: none;
  }

  .play-pause.large .btn-spinner {
    border-color: rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
  }

  .mini-play.loading .btn-spinner,
  .play-pause.loading .btn-spinner {
    opacity: 1;
    transform: scale(1);
  }

  .mini-play.loading .icon-play,
  .mini-play.loading .icon-pause,
  .play-pause.loading .icon-play,
  .play-pause.loading .icon-pause {
    opacity: 0;
    transform: scale(0.4) rotate(40deg);
  }

  @keyframes btn-spin {
    to { transform: rotate(360deg); }
  }

  .mini-play svg,
  .play-pause svg {
    position: absolute;
    inset: 0;
    margin: auto;
  }

  .mini-play .icon-play,
  .mini-play .icon-pause {
    fill: #fff;
  }

  .mini-play .icon-play,
  .mini-play .icon-pause,
  .play-pause .icon-play,
  .play-pause .icon-pause {
    transition: opacity 0.22s ease, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .mini-play .icon-pause,
  .play-pause .icon-pause {
    opacity: 0;
    transform: scale(0.4) rotate(-40deg);
  }

  .mini-play.playing .icon-pause,
  .play-pause.playing .icon-pause {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  .mini-play.playing .icon-play,
  .play-pause.playing .icon-play {
    opacity: 0;
    transform: scale(0.4) rotate(40deg);
  }

  .pc-collapse {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 24px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease;
    opacity: 0;
    visibility: hidden;
    will-change: transform, opacity;
  }

  .pc-collapse:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .pc-extra {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    visibility: hidden;
    will-change: transform, opacity;
  }

  .progress-bar {
    position: relative;
    width: 100%;
  }

  .progress-track {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    overflow: hidden;
    cursor: pointer;
    transition: height 0.2s ease;
  }

  .progress-track:hover {
    height: 5px;
  }

  .progress-fill {
    height: 100%;
    width: 0%;
    border-radius: 2px;
    background: linear-gradient(90deg, #7aa2ff, #ffffff);
    transition: width 0.1s linear;
  }

  .progress-knob {
    position: absolute;
    top: -4px;
    left: 0;
    width: 11px;
    height: 11px;
    margin-left: -5.5px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.18), 0 0 10px rgba(255, 255, 255, 0.6);
    opacity: 0;
    transform: scale(0.5);
    transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    pointer-events: none;
  }

  .progress-bar:hover .progress-knob {
    opacity: 1;
    transform: scale(1);
  }

  .progress-time {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
    font-weight: 500;
  }

  .expanded-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    margin-top: 4px;
  }

  .ctrl-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    transition: color 0.15s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    line-height: 1;
    flex-shrink: 0;
  }

  .ctrl-btn svg {
    fill: currentColor;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
  }

  .ctrl-btn:hover {
    color: #fff;
    transform: translateY(-2px) scale(1.12);
  }

  .ctrl-btn:active {
    transform: translateY(0) scale(0.92);
  }

  .ctrl-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .play-pause {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.35);
    color: #fff;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
    backdrop-filter: blur(10px) saturate(1.4) brightness(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.4) brightness(1.2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 0 -6px 12px rgba(255, 255, 255, 0.06), 0 0px 6px rgba(0, 0, 0, 0.18);
  }

  .play-pause:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .play-pause.large {
    width: 56px;
    height: 56px;
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.4);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -8px 16px rgba(255, 255, 255, 0.08), 0 0px 8px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(5px) saturate(1.4) brightness(1.45);
    -webkit-backdrop-filter: blur(5px) saturate(1.4) brightness(1.45);
  }

  .play-pause.large:hover {
    background: rgba(255, 255, 255, 0.24);
    transform: scale(1.06);
  }

  .play-pause.large:active {
    transform: scale(0.94);
  }

  .play-pause.large svg {
    fill: currentColor;
    filter: none;
  }
</style>

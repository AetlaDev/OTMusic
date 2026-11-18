<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gsap } from 'gsap';
  import { initLiquidGlass } from '../lib/effects/liquidGlass';
  import { config } from '../lib/config';
  import { pageLoad } from '../lib/loading';

  export let onSearch: (keyword: string) => void = () => {};

  export let enter = false;

  let barEl: HTMLFormElement;
  let btnEl: HTMLButtonElement;
  let liquidGlass: any = null;
  let keyword = '';
  let entranceTweens: gsap.core.Animation[] = [];

  let entered = false;

  const FULL_W_CAP = 380;

  const BTN_ZONE = 60;

  let fullW = FULL_W_CAP;
  let compactW = fullW - BTN_ZONE;
  let barLeft = 0;
  let barTop = 20;
  let barH = 54;

  $: hasText = keyword.trim().length > 0;

  const GLASS_PARAMS = {
    ...config.liquidGlass,
    edgeHighlight: 0.05,
    brightness: 0.2,
    chromAberration: 0.45,
    cornerRadius: 15,
    shadowOpacity: 0.1,
    shadowSpread: 5,
  };

  const BTN_GLASS_PARAMS = {
    ...GLASS_PARAMS,
    edgeHighlight: 0.28,
    brightness: 0.45,
    cornerRadius: 15,
  };

  function submit() {
    const kw = keyword.trim();
    if (kw) onSearch(kw);
  }

  function computeLayout() {
    fullW = Math.min(FULL_W_CAP, window.innerWidth * 0.92, window.innerWidth - 24);
    compactW = fullW - BTN_ZONE;
    barLeft = (window.innerWidth - fullW) / 2;
    barTop = window.innerWidth <= 700 ? 25 : 20;
    barH = barEl?.offsetHeight || 54;
  }

  function playEntrance() {
    if (!barEl) return;
    entranceTweens.forEach((t) => t.kill());
    entranceTweens = [];
    const e = gsap.timeline({
      onComplete: () => (entered = true),
      onInterrupt: () => (entered = true),
    });
    e.fromTo(
      barEl,
      { y: -(barH + 25), autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.3)' },
      0
    );
    entranceTweens = e.getChildren();
  }

  $: if (enter) playEntrance();

  onMount(async () => {
    computeLayout();
    window.addEventListener('resize', computeLayout);
    pageLoad.start('glass-search');
    try {
      liquidGlass = await initLiquidGlass([barEl, btnEl], barEl.parentElement!, [GLASS_PARAMS, BTN_GLASS_PARAMS]);
    } catch (e) {
      console.error('[SearchBar] 液态玻璃初始化失败', e);
    } finally {
      pageLoad.done('glass-search');
    }
  });

  onDestroy(() => {
    entranceTweens.forEach((t) => t.kill());
    window.removeEventListener('resize', computeLayout);
    liquidGlass?.destroy?.();
    liquidGlass = null;
  });
</script>

<form
  id="search-form"
  class="search-bar glass"
  class:entered={entered}
  bind:this={barEl}
  style="left:{barLeft}px; top:{barTop}px; width:{hasText ? compactW : fullW}px"
  on:submit|preventDefault={submit}
>
  <svg class="search-icon" viewBox="0 0 24 24" width="17" height="17">
    <path d="M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <input bind:value={keyword} placeholder="搜索歌曲" aria-label="搜索歌曲" />
</form>
<button
  type="submit"
  form="search-form"
  class="search-btn glass"
  class:visible={hasText}
  bind:this={btnEl}
  style="left:{barLeft + compactW + 8}px; top:{barTop}px; height:{barH}px"
  title="搜索"
>搜索</button>

<style>
  :global(:root) {
    --search-radius: 10px;
  }

  .search-bar {
    position: fixed;
    z-index: 4;

    transform: translateY(calc(-100% - 25px));
    opacity: 0;
    visibility: hidden;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 68px 16px 16px;
    border-radius: var(--search-radius);
    background: transparent;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;

    transition: width 0.55s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: width;
  }

  .search-bar.entered {
    transform: none;
    opacity: 1;
    visibility: visible;
  }

  .search-icon {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .search-bar input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: #fff;

    font-size: 16px;
  }

  .search-bar input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .search-btn {
    position: fixed;
    z-index: 5;

    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    border: none;

    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    opacity: 0;
    visibility: hidden;
    transform: scale(0.5);
    pointer-events: none;
    transition: opacity 0.28s ease 0.05s, transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.08s, visibility 0s linear 0.28s;
  }

  .search-btn.visible {
    opacity: 1;
    visibility: visible;
    transform: scale(1);
    pointer-events: auto;
    transition: opacity 0.28s ease 0.05s, transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.08s, visibility 0s linear 0s;
  }

  .search-btn:hover {
    color: #fff;
  }
</style>

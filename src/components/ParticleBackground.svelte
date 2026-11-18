<script lang="ts">
  import { onMount } from 'svelte';
  import type { AudioVisualizer, LyricLine, ParticleEngine } from '../lib/types';
  import { createParticleEngine } from '../lib/effects/particleEngine';
  import { pageLoad } from '../lib/loading';

  export let visualizer: AudioVisualizer;
  export let coverUrl = '';
  export let lyrics: LyricLine[] = [];
  export let lyricsVisible = true;
  export let enter = false;

  let canvas: HTMLCanvasElement;
  let fxCanvas: HTMLCanvasElement;
  let lyricCanvas: HTMLCanvasElement;
  let engine: ParticleEngine | null = null;

  let particlesSettled = false;
  let appliedCover = '';

  let warmTaskStarted = false;

  function settleParticles() {
    if (particlesSettled) return;
    particlesSettled = true;
    pageLoad.done('particles');
  }

  onMount(() => {
    engine = createParticleEngine(canvas, lyricCanvas, fxCanvas, () => visualizer.getEnergies());
    const audio = document.getElementById('audio') as HTMLAudioElement;
    engine.setTimeSource(() => (audio ? audio.currentTime : 0));
    pageLoad.start('particles');

    setTimeout(() => {
      if (!particlesSettled) settleParticles();
    }, 3000);
    if (coverUrl) {
      engine.setCover(coverUrl).then(settleParticles);
    } else {

      engine.ready.then(() => {
        const eng = engine;
        if (eng && coverUrl && !particlesSettled) eng.setCover(coverUrl).then(settleParticles);
      });
    }
  });

  $: if (engine && coverUrl && coverUrl !== appliedCover) {
    appliedCover = coverUrl;
    engine.setCover(coverUrl).then(settleParticles);
  }
  $: if (engine) engine.setLyrics(lyrics);

  $: if (engine && lyrics.length && !warmTaskStarted) {
    warmTaskStarted = true;
    pageLoad.start('lyric-warm');
    engine.lyricWarmReady.then(() => pageLoad.done('lyric-warm'));
  }
  $: if (engine) engine.setLyricVisible(lyricsVisible);

  $: if (enter && engine) engine.startEnter();
</script>

<canvas id="particle-bg" data-dynamic bind:this={canvas}></canvas>
<canvas id="particle-fx" data-dynamic bind:this={fxCanvas}></canvas>
<canvas id="lyric-bg" data-dynamic bind:this={lyricCanvas}></canvas>

<style>
  #particle-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: block;
    pointer-events: none;
  }
  #particle-fx {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: block;
    cursor: grab;
    touch-action: none;
  }
  #lyric-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: block;
    pointer-events: none;
  }
  #particle-fx:global(.dragging) {
    cursor: grabbing;
  }
</style>

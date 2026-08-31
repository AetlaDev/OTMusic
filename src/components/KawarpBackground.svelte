<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Kawarp } from '@kawarp/core';
  import { config } from '../lib/config';
  import { pageLoad } from '../lib/loading';

  export let coverUrl = '';

  const KW = config.kawarp;

  let canvas: HTMLCanvasElement;
  let kawarp: any = null;
  let loadedCover: string | null = null;

  function fitCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    kawarp?.resize();
  }

  async function loadCover(src: string) {
    if (!kawarp || !src || src === loadedCover) return;
    try {
      await kawarp.loadImage(src);
      loadedCover = src;
      kawarp.start();
    } catch (err) {
      console.error('[kawarp] 封面背景加载失败:', err);
    }
  }

  onMount(async () => {
    pageLoad.start('kawarp');
    try {
      kawarp = new Kawarp(canvas, {
        warpIntensity: KW.warpIntensity,
        blurPasses: KW.blurPasses,
        animationSpeed: KW.animationSpeed,
        transitionDuration: KW.transitionDuration,
        saturation: KW.saturation,
        tintColor: KW.tintColor,
        tintIntensity: KW.tintIntensity,
        dithering: KW.dithering,
        scale: KW.scale,
      });
      fitCanvas();

      if (coverUrl) await loadCover(coverUrl);
    } finally {
      pageLoad.done('kawarp');
    }

    window.addEventListener('resize', fitCanvas);
  });

  onDestroy(() => {
    window.removeEventListener('resize', fitCanvas);
    kawarp?.dispose();
    kawarp = null;
  });

  $: if (kawarp) loadCover(coverUrl);
</script>

<canvas id="kawarp-bg" bind:this={canvas}></canvas>
<div class="kawarp-overlay" style:background={`rgba(0, 0, 0, ${KW.overlayOpacity})`}></div>

<style>
  #kawarp-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    display: block;
  }

  .kawarp-overlay {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
</style>

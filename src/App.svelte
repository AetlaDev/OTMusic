<script lang="ts">
  import { onMount } from 'svelte';
  import type { Song, LyricLine, AudioVisualizer } from './lib/types';
  import KawarpBackground from './components/KawarpBackground.svelte';
  import ParticleBackground from './components/ParticleBackground.svelte';
  import PlayerCard from './components/PlayerCard.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import { createAudioVisualizer } from './lib/audio/audioVisualizer';
  import { searchSongs, getTopSongs, getSongUrl, getLyric, getSongById } from './lib/services/api';
  import { parseLRC, matchTranslations } from './lib/text/lyrics';
  import { pageLoad } from './lib/loading';

  const visualizer: AudioVisualizer = createAudioVisualizer();

  const DEFAULT_SONG_ID = 1974630461;
  let root: HTMLElement;
  let audioEl: HTMLAudioElement;

  let songs: Song[] = [];
  let currentIndex = -1;
  let currentSong: Song | null = null;
  let loadingSong = false;
  let toast: string | null = null;
  let toastTimer: number | null = null;
  let showLyrics = true;
  let lyricLines: LyricLine[] = [];
  let lyricLoadToken = 0;
  let resumeHandler: (() => void) | null = null;

  let appReady = false;
  let loaderGone = false;

  function setupResumeOnInteraction() {
    if (resumeHandler) return;
    resumeHandler = () => {
      resumeHandler = null;
      document.removeEventListener('pointerdown', resumeHandler);
      document.removeEventListener('keydown', resumeHandler);
      document.removeEventListener('touchstart', resumeHandler);
      if (audioEl && audioEl.paused && audioEl.src && currentSong) {
        audioEl.play().catch(() => {});
      }
    };
    document.addEventListener('pointerdown', resumeHandler);
    document.addEventListener('keydown', resumeHandler);
    document.addEventListener('touchstart', resumeHandler);
  }

  onMount(async () => {
    visualizer.bind(audioEl);
    const loadStart = performance.now();

    const fallback = new Promise<void>((res) => setTimeout(res, 20000));
    Promise.race([pageLoad.ready, fallback]).then(() => {

      const elapsed = performance.now() - loadStart;
      const remain = Math.max(0, 1000 - elapsed);
      setTimeout(() => {
        appReady = true;
        setTimeout(() => (loaderGone = true), 600);
      }, remain);
    });
    await loadTopSongs(0);
    await loadDefaultSong();
  });

  async function loadDefaultSong() {
    pageLoad.start('default-song');
    pageLoad.start('analysis');
    try {
      const song = await getSongById(DEFAULT_SONG_ID);
      if (!song) return;
      songs = [song, ...songs.filter((s) => s.id !== song.id)];
      currentIndex = 0;
      currentSong = song;
      const url = await getSongUrl(song.id);
      if (url) audioEl.src = url;
    } catch (e) {

    } finally {

      visualizer.ensureGraph();
      pageLoad.done('analysis');
      pageLoad.done('default-song');
    }
  }

  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2500);
  }

  function syncCurrentIndex() {
    const cur = currentSong;
    if (cur && songs.length) {
      currentIndex = songs.findIndex((s) => s.id === cur.id);
    } else {
      currentIndex = -1;
    }
  }

  async function loadTopSongs(type) {
    try {
      songs = await getTopSongs(type, 50);
    } catch (e) {
      songs = [];
    }
    syncCurrentIndex();
  }

  async function doSearch(keyword) {
    const kw = (keyword || '').trim();
    if (!kw) {
      await loadTopSongs(0);
      return;
    }
    try {
      songs = await searchSongs(kw, 30);
      if (!songs.length) {
        showToast('未找到相关歌曲');
        return;
      }
      syncCurrentIndex();
      await playIndex(0);
    } catch (e) {
      showToast('搜索失败，请稍后重试');
      songs = [];
    }
  }

  async function playIndex(index) {
    if (index < 0 || index >= songs.length) return;
    if (index === currentIndex) {
      if (audioEl && audioEl.src) audioEl.play().catch(() => {});
      return;
    }
    currentIndex = index;
    currentSong = songs[index];
    loadingSong = true;
    try {
      const url = await getSongUrl(currentSong.id);
      if (!url) {
        showToast('该歌曲暂时无法播放，试试其他歌曲');
        return;
      }
      audioEl.src = url;
      visualizer.ensureGraph();
      visualizer.resetBeat();
      await audioEl.play();
    } catch (e) {

      if (e?.name === 'NotAllowedError' && audioEl.src) {
        setupResumeOnInteraction();
        return;
      }
      showToast('播放失败，请重试');
    } finally {
      loadingSong = false;
    }
  }

  function playNext() {
    if (!songs.length) return;
    const idx = currentIndex < 0 ? 0 : (currentIndex + 1) % songs.length;
    playIndex(idx);
  }

  function playPrev() {
    if (!songs.length) return;
    const idx = currentIndex < 0 ? songs.length - 1 : (currentIndex - 1 + songs.length) % songs.length;
    playIndex(idx);
  }

  function onEnded() {
    if (currentIndex < songs.length - 1) {
      playIndex(currentIndex + 1);
    } else {
      showToast('已播放完当前列表');
    }
  }

  async function loadLyric(id) {
    const token = ++lyricLoadToken;
    pageLoad.start('lyrics');
    try {
      const { lrc, tlyric } = await getLyric(id);
      if (token !== lyricLoadToken) return;
      const base = parseLRC(lrc);
      const transMap = matchTranslations(base, parseLRC(tlyric));
      lyricLines = base.map((l, i) => ({
        time: l.time,
        text: l.text,
        trans: transMap.get(i) || '',
      }));
    } catch (e) {
      if (token !== lyricLoadToken) return;
      lyricLines = [];
    } finally {
      pageLoad.done('lyrics');
    }
  }

  $: if (currentSong?.id) loadLyric(currentSong.id);
</script>

<div id="root" bind:this={root}>
  <KawarpBackground coverUrl={currentSong?.cover || ''} />
  <ParticleBackground
    {visualizer}
    coverUrl={currentSong?.cover || ''}
    lyrics={lyricLines}
    lyricsVisible={showLyrics}
    enter={appReady}
  />
  <SearchBar onSearch={doSearch} enter={appReady} />
  <PlayerCard
    song={currentSong}
    loading={loadingSong}
    canPrev={songs.length > 0}
    canNext={songs.length > 0}
    onPrev={playPrev}
    onNext={playNext}
    {visualizer}
    enter={appReady}
  />
  <audio id="audio" crossorigin="anonymous" preload="metadata" bind:this={audioEl} onended={onEnded}></audio>
  {#if toast}
    <div class="toast">{toast}</div>
  {/if}
  {#if !loaderGone}
    <div class="page-loader" class:leaving={appReady} aria-hidden="true">
      <div class="loader-ring"></div>
      <p class="loader-text">LOADING</p>
    </div>
  {/if}
</div>

<style>
  .toast {
    position: fixed;
    bottom: 18vh;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 22, 40, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    padding: 10px 18px;
    border-radius: 999px;
    font-size: 13px;
    z-index: 10;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(12px);
  }

  .page-loader {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    background: radial-gradient(120% 120% at 50% 0%, #0d1122 0%, #05060f 62%);
    transition: opacity 0.55s ease, visibility 0s linear 0.55s;
  }

  .page-loader.leaving {
    opacity: 0;
    visibility: hidden;
  }

  .loader-ring {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.14);
    border-top-color: #7aa2ff;
    animation: loader-spin 0.8s linear infinite;
  }

  .loader-text {
    margin: 0;
    font-size: 11px;
    letter-spacing: 4px;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
  }

  @keyframes loader-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

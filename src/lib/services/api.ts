import type { Song } from '../types';

const BASE = 'https://zm.wwoyun.cn';

function toHttps(url) {
  return url ? url.replace(/^http:\/\//, 'https://') : url;
}

function normalizeSong(s) {
  const artists = s.artists || s.ar || [];
  const album = s.album || s.al || {};
  return {
    id: s.id,
    name: s.name || '',
    artist: artists.map((a) => a.name).filter(Boolean).join(' / '),
    album: album.name || '',
    cover: toHttps(album.picUrl || ''),
    duration: s.duration || s.dt || 0,
  };
}

async function fillSongCovers(songs: Song[]): Promise<void> {
  if (!songs.length) return;
  try {
    const ids = songs.map((s) => s.id).filter(Boolean);
    if (!ids.length) return;
    const data = await getJSON(`/song/detail?ids=${ids.join(',')}`);
    const coverMap = new Map();
    for (const s of data.songs || []) {
      const pic = toHttps((s.al || {}).picUrl || '');
      if (pic) coverMap.set(s.id, pic);
    }
    for (const song of songs) {
      const pic = coverMap.get(song.id);
      if (pic) song.cover = pic;
    }
  } catch (e) {

  }
}

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function searchSongs(keywords: string, limit = 30): Promise<Song[]> {
  const data = await getJSON(
    `/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=0&type=1`
  );
  const songs = (data.result?.songs || []).map(normalizeSong);
  await fillSongCovers(songs);
  return songs;
}

export async function getTopSongs(type = 0, limit = 50): Promise<Song[]> {
  const data = await getJSON(`/top/song?type=${type}&limit=${limit}`);
  return (data.data || []).map(normalizeSong);
}

export async function getSongById(id: number | string): Promise<Song | null> {
  const data = await getJSON(`/song/detail?ids=${id}`);
  const s = (data.songs || [])[0];
  if (!s) return null;
  return normalizeSong(s);
}

export async function getSongUrl(id: number | string): Promise<string | null> {
  const data = await getJSON(`/song/url/v1?id=${id}&level=standard`);
  const item = (data.data || []).find((s) => s.id === id) || (data.data || [])[0];
  const url = toHttps(item?.url || '');
  return url || null;
}

export async function getLyric(id: number | string): Promise<{ lrc: string; tlyric: string }> {
  const data = await getJSON(`/lyric?id=${id}`);
  return {
    lrc: data.lrc?.lyric || '',
    tlyric: data.tlyric?.lyric || '',
  };
}

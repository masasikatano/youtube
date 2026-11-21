"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Video = { id: string; title: string; channel: string; publishedAt: string; thumb: string };
type Period = "today" | "week" | "month" | "year";
const LABELS: { v: Period; label: string }[] = [
  { v: "today", label: "今日" },
  { v: "week", label: "今週" },
  { v: "month", label: "今月" },
  { v: "year", label: "今年" },
];

declare global { interface Window { YT?: { Player: new (el: HTMLElement, opts: object) => { setPlaybackRate(r: number): void; getIframe(): HTMLIFrameElement } }; onYouTubeIframeAPIReady?: () => void } }

export default function Home() {
  const [period, setPeriod] = useState<Period>("today");
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Video | null>(null);
  const [rate2x, setRate2x] = useState(false);
  const playerRef = useRef<{ setPlaybackRate(r: number): void; getIframe(): HTMLIFrameElement } | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/videos?period=${period}`).then(async (r) => {
      const j = await r.json();
      if (j.error) setError("取得に失敗しました（時間をおいて再読み込みしてください）");
      setVideos(j.videos ?? []);
      setLoading(false);
    }).catch(() => { setError("取得に失敗しました（時間をおいて再読み込みしてください）"); setLoading(false); });
  }, [period]);

  // YT IFrame API 読み込み（2x切替用）
  useEffect(() => {
    if (document.getElementById("yt-api")) return;
    const s = document.createElement("script");
    s.id = "yt-api";
    s.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(s);
  }, []);

  useEffect(() => {
    if (!open || !mountRef.current) return;
    setRate2x(false);
    const create = () => {
      if (!mountRef.current || !window.YT) { setTimeout(create, 200); return; }
      mountRef.current.innerHTML = '<div id="ytp"></div>';
      const el = document.getElementById("ytp")!;
      playerRef.current = new window.YT.Player(el, {
        videoId: open.id,
        playerVars: { autoplay: 1, rel: 0 },
        events: {},
      });
    };
    create();
  }, [open]);

  const fullscreen = useCallback(() => {
    const iframe = playerRef.current?.getIframe() ?? mountRef.current?.querySelector("iframe");
    if (!iframe) return;
    const req = iframe.requestFullscreen ?? (iframe as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.bind(iframe);
    if (typeof req === "function") (req as () => void).call(iframe);
  }, []);

  const toggleRate = useCallback(() => {
    const next = !rate2x;
    setRate2x(next);
    try { playerRef.current?.setPlaybackRate(next ? 2 : 1); } catch { /* iPad等で不可の場合あり */ }
  }, [rate2x]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold">YouTube 一覧</h1>
      <div className="mt-3 flex gap-2">
        {LABELS.map(({ v, label }) => (
          <button key={v} onClick={() => setPeriod(v)}
            className={`rounded-full border px-4 py-1 text-sm ${period === v ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
            {label}
          </button>
        ))}
      </div>
      {loading ? <p className="mt-6 text-sm">読み込み中…</p> : error ? <p className="mt-6 text-sm text-red-600">{error}</p> : videos.length === 0 ? <p className="mt-6 text-sm">動画がありません</p> : (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          {videos.map((v) => (
            <button key={v.id} onClick={() => setOpen(v)} className="overflow-hidden rounded-lg border bg-white text-left text-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.thumb} alt="" className="aspect-video w-full object-cover" />
              <div className="p-2">
                <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
                <p className="mt-1 text-xs text-zinc-600">{v.channel}・{new Date(v.publishedAt).toLocaleDateString("ja-JP")}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-3xl rounded-lg bg-black p-2" onClick={(e) => e.stopPropagation()}>
            <div ref={mountRef} className="aspect-video w-full [&_iframe]:h-full [&_iframe]:w-full" />
            <div className="flex gap-2 p-2">
              <button onClick={fullscreen} className="rounded bg-white px-4 py-2 text-sm font-medium text-zinc-900">全画面</button>
              <button onClick={toggleRate} className={`rounded px-4 py-2 text-sm font-medium ${rate2x ? "bg-red-600 text-white" : "bg-white text-zinc-900"}`}>
                {rate2x ? "2x ON" : "2x"}
              </button>
              <button onClick={() => setOpen(null)} className="ml-auto rounded bg-white px-4 py-2 text-sm text-zinc-900">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

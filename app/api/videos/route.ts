import { NextRequest, NextResponse } from "next/server";

const KEYWORDS = ["restoration", "bushcraft", "knife making"];

function publishedAfterFor(period: string): string {
  const now = Date.now();
  const days: Record<string, number> = { today: 1, week: 7, month: 30, year: 365 };
  const d = days[period] ?? 7;
  return new Date(now - d * 86400000).toISOString();
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "missing API key" }, { status: 500 });
  const period = new URL(req.url).searchParams.get("period") ?? "week";
  const publishedAfter = publishedAfterFor(period);

  try {
    // 3キーワード並列取得（期間×キーワード単位で1日キャッシュ）
    const lists = await Promise.all(
      KEYWORDS.map(async (q) => {
        // 2ページ×50件で最大100件/キーワード取得（search 100unit×2リクエスト）
        const items: { id: { videoId: string }; snippet: { publishedAt: string; title: string; channelTitle: string; thumbnails: { medium?: { url: string } }; description: string } }[] = [];
        let pageToken = "";
        for (let p = 0; p < 2; p++) {
          const url =
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date` +
            `&maxResults=50&publishedAfter=${encodeURIComponent(publishedAfter)}` +
            `&q=${encodeURIComponent(q)}&key=${apiKey}` +
            (pageToken ? `&pageToken=${pageToken}` : "");
          const r = await fetch(url, { next: { revalidate: 86400 } });
          if (!r.ok) throw new Error(`search failed: ${r.status} ${await r.text()}`);
          const j = await r.json();
          items.push(...(j.items ?? []));
          if (!j.nextPageToken) break;
          pageToken = j.nextPageToken;
        }
        return items;
      })
    );

    // 重複排除
    const seen = new Map<string, { id: string; title: string; channel: string; publishedAt: string; thumb: string; desc: string }>();
    for (const items of lists) {
      for (const it of items) {
        const id = it.id?.videoId;
        if (!id || seen.has(id)) continue;
        seen.set(id, {
          id,
          title: it.snippet.title,
          channel: it.snippet.channelTitle,
          publishedAt: it.snippet.publishedAt,
          thumb: it.snippet.thumbnails?.medium?.url ?? "",
          desc: it.snippet.description,
        });
      }
    }
    const ids = [...seen.keys()];
    if (ids.length === 0) return NextResponse.json({ videos: [] });

    // 詳細取得してShorts除外（Shortsは最長3分のため、3分超は通常動画とみなす）
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const shortIds = new Set<string>();
    const durations = new Map<string, number>();
    for (const c of chunks) {
      const url =
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${c.join(",")}&key=${apiKey}`;
      const r = await fetch(url, { next: { revalidate: 86400 } });
      if (!r.ok) throw new Error(`videos failed: ${r.status} ${await r.text()}`);
      const j = await r.json();
      for (const v of j.items ?? []) {
        const sec = parseDuration(v.contentDetails?.duration ?? "");
        durations.set(v.id, sec);
        if (sec <= 60) shortIds.add(v.id);
      }
    }
    // 3分以内の動画は /shorts/<id> で判定（Shortsなら200、通常動画は/watchへリダイレクト）
    await Promise.all(
      [...durations.entries()]
        .filter(([id, sec]) => sec > 60 && sec <= 190 && !shortIds.has(id))
        .map(async ([id]) => {
          try {
            const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
              next: { revalidate: 86400 },
            });
            // 同意画面など想定外の行き先の場合は除外しない（fail open）
            if (r.url.includes("/shorts/")) shortIds.add(id);
          } catch {
            /* 判定不能時は残す */
          }
        })
    );
    const videos = [...seen.values()]
      .filter((v) => !shortIds.has(v.id) && !/#shorts/i.test(v.title + " " + v.desc))
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    return NextResponse.json({ videos });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

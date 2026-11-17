import { NextRequest, NextResponse } from "next/server";

const KEYWORDS = ["restoration", "bushcraft", "knife making"];

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" };

function publishedAfterFor(period: string): string {
  const days: Record<string, number> = { today: 1, week: 7, month: 30, year: 365 };
  const d = days[period] ?? 7;
  const JST = 9 * 3600 * 1000;
  const nowJst = new Date(Date.now() + JST);
  // JST 今日 00:00 の epoch（UTC 換算）
  const startOfTodayJst =
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - JST;
  return new Date(startOfTodayJst - (d - 1) * 86400000).toISOString();
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

async function isShort(id: string): Promise<"short" | "normal" | "unknown"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
        redirect: "manual",
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (r.status === 200) return "short";
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get("location") ?? "";
        if (loc.includes("/watch")) return "normal";
        // consent 等の想定外リダイレクト → unknown（リトライへ）
        continue;
      }
      // 403 / 429 / その他 → unknown（リトライへ）
      continue;
    } catch {
      continue;
    }
  }
  return "unknown";
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
        // 4ページ×50件で最大200件/キーワード取得（search 100unit×4リクエスト）
        const items: { id: { videoId: string }; snippet: { publishedAt: string; title: string; channelTitle: string; thumbnails: { medium?: { url: string } }; description: string } }[] = [];
        let pageToken = "";
        for (let p = 0; p < 4; p++) {
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
    if (ids.length === 0) return NextResponse.json({ videos: [] }, { headers: CACHE_HEADERS });

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
    // durations に無い動画（videos.list に含まれなかった）は除外
    let excludedUnknownDuration = 0;
    for (const id of ids) {
      if (!durations.has(id) && !shortIds.has(id)) {
        shortIds.add(id);
        excludedUnknownDuration++;
      }
    }
    const excludedLe60 = [...shortIds].length - excludedUnknownDuration;
    // 61〜190秒帯のみ /shorts/<id> で判定（リダイレクトを辿らず判定、unknown は除外）
    const targets = [...durations.entries()]
      .filter(([id, sec]) => sec > 60 && sec <= 190 && !shortIds.has(id))
      .map(([id]) => id);
    let excludedShort = 0;
    let excludedUnknown = 0;
    for (let i = 0; i < targets.length; i += 5) {
      const chunk = targets.slice(i, i + 5);
      const results = await Promise.all(chunk.map((id) => isShort(id)));
      results.forEach((res, idx) => {
        if (res === "short") {
          shortIds.add(chunk[idx]);
          excludedShort++;
        } else if (res === "unknown") {
          shortIds.add(chunk[idx]);
          excludedUnknown++;
        }
      });
    }
    const videos = [...seen.values()]
      .filter((v) => !shortIds.has(v.id) && !/#shorts/i.test(v.title + " " + v.desc))
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    console.log(
      `period=${period} searched=${ids.length} excluded_le60=${excludedLe60} excluded_unknown_duration=${excludedUnknownDuration} excluded_short=${excludedShort} excluded_unknown=${excludedUnknown} final=${videos.length}`
    );
    return NextResponse.json({ videos }, { headers: CACHE_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

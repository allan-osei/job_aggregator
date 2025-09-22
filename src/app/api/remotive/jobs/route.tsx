import { NextResponse } from "next/server";

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10);

let cache: {
  expires: number;
  data: null | { jobs: any[]; meta: any };
} = { expires: 0, data: null };

async function fetchLeverBoard(token: string) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(
    token
  )}?mode=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lever token ${token} -> ${res.status}`);

  const json = await res.json();

  return (json as any[]).map((job: any) => ({
    source: "lever",
    company: token,
    id: job.id,
    title: job.text,
    location: job.categories?.location ?? "",
    type: job.categories?.commitment ?? "N/A",
    url: job.hostedUrl,
    raw: job,
  }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // ✅ Prefer `company` param to match Greenhouse route
    const company = searchParams.get("company");
    const tokens = company
      ? [company]
      : process.env.LEVER_TOKENS
      ? process.env.LEVER_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    if (tokens.length === 0) {
      return NextResponse.json(
        { error: "No Lever company provided" },
        { status: 400 }
      );
    }

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const nocache = searchParams.get("nocache");

    // ✅ Cache check
    if (cache.data && Date.now() < cache.expires && !nocache) {
      const total_jobs = cache.data.jobs.length;
      const total_pages = Math.ceil(total_jobs / limit);
      const start = (page - 1) * limit;
      const paged = cache.data.jobs.slice(start, start + limit);

      return NextResponse.json({
        jobs: paged,
        meta: {
          ...cache.data.meta,
          page,
          limit,
          total_pages,
        },
      });
    }

    const results: any[] = [];
    const failures: string[] = [];

    for (const token of tokens) {
      try {
        const jobs = await fetchLeverBoard(token);
        results.push(...jobs);
      } catch (err) {
        failures.push(`Lever(${token}): ${String(err)}`);
      }
    }

    // ✅ Deduplicate by URL or ID
    const seen = new Set();
    const deduped = results.filter((job) => {
      const key = job.url || `${job.source}-${job.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const total_jobs = deduped.length;
    const total_pages = Math.ceil(total_jobs / limit);
    const start = (page - 1) * limit;
    const paged = deduped.slice(start, start + limit);

    const payload = {
      jobs: paged,
      meta: {
        fetched_at: new Date().toISOString(),
        failures,
        total_jobs,
        total_pages,
        page,
        limit,
        count: paged.length,
      },
    };

    // ✅ Save in cache
    cache.data = { jobs: deduped, meta: payload.meta };
    cache.expires = Date.now() + CACHE_TTL * 1000;

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal error", details: String(err) },
      { status: 500 }
    );
  }
}

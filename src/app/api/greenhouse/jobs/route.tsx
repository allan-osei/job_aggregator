import { NextResponse } from "next/server";

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10);

let cache: {
  expires: number;
  data: null | {
    jobs: any[];
    meta: {
      fetched_at: string;
      count: number;
      failures: string[];
      total_jobs: number;
      total_pages: number;
      page: number;
      limit: number;
    };
  };
} = { expires: 0, data: null };

const GREENHOUSE_TOKENS = process.env.GREENHOUSE_TOKENS
  ? process.env.GREENHOUSE_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["airbnb", "stripe"];

const LEVER_TOKENS = process.env.LEVER_TOKENS
  ? process.env.LEVER_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["lever", "robinhood"];

const REMOTIVE_BASE = "https://remotive.com/api/remote-jobs";

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  metadata?: { name: string; value: string }[];
  [key: string]: any;
}

async function fetchGreenhouseBoard(token: string) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greenhouse token ${token} -> ${res.status}`);
  const json = await res.json();
  return (json.jobs as GreenhouseJob[]).map((job: GreenhouseJob) => ({
    source: "greenhouse",
    company: token,
    id: job.id,
    title: job.title,
    location: job.location?.name ?? "",
    type: job.metadata?.find((m) => m.name === "Employment Type")?.value ?? "N/A",
    url: job.absolute_url,
    raw: job,
  }));
}

async function fetchLeverBoard(token: string) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
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

async function fetchRemotive({
  limit,
  search,
  company_name,
}: {
  limit?: string;
  search?: string;
  company_name?: string;
}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit);
  if (search) params.set("search", search);
  if (company_name) params.set("company_name", company_name);
  const url = `${REMOTIVE_BASE}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Remotive fetch -> ${res.status}`);
  const json = await res.json();
  return json.jobs.map((job: any) => ({
    source: "remotive",
    company: job.company_name,
    id: job.id,
    title: job.title,
    location: job.candidate_required_location || "",
    type: job.job_type || "N/A",
    url: job.url,
    raw: job,
  }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // ✅ Tokens
    const tokensGH = (searchParams.get("greenhouse_tokens") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tokensLever = (searchParams.get("lever_tokens") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const finalTokensGH = tokensGH.length ? tokensGH : GREENHOUSE_TOKENS;
    const finalTokensLever = tokensLever.length ? tokensLever : LEVER_TOKENS;

    // ✅ Remotive params
    const remotiveLimit = searchParams.get("remotive_limit");
    const remotiveSearch = searchParams.get("remotive_search");
    const remotiveCompany = searchParams.get("remotive_company");

    // ✅ Pagination params
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const nocache = searchParams.get("nocache");

    // ✅ Use cache if valid
    if (cache.data && Date.now() < cache.expires && !nocache) {
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ Returning cached results");
      }

      const total_jobs = cache.data.meta.total_jobs;
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

    const failures: string[] = [];
    const results: any[] = [];

    // ✅ Fetch all
    const promises: Promise<any>[] = [
      ...finalTokensGH.map((t) => fetchGreenhouseBoard(t)),
      ...finalTokensLever.map((t) => fetchLeverBoard(t)),
      fetchRemotive({
        limit: remotiveLimit ?? undefined,
        search: remotiveSearch ?? undefined,
        company_name: remotiveCompany ?? undefined,
      }),
    ];

    const settled = await Promise.allSettled(promises);

    settled.forEach((res, idx) => {
      if (res.status === "fulfilled") {
        results.push(...res.value);
      } else {
        const label =
          idx < finalTokensGH.length
            ? `Greenhouse(${finalTokensGH[idx]})`
            : idx < finalTokensGH.length + finalTokensLever.length
            ? `Lever(${finalTokensLever[idx - finalTokensGH.length]})`
            : "Remotive";
        failures.push(`${label}: ${String(res.reason)}`);
      }
    });

    // ✅ Deduplicate
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
        count: paged.length,
        failures,
        total_jobs,
        total_pages,
        page,
        limit,
      },
    };

    cache.data = {
      jobs: deduped, // keep full dataset in cache
      meta: { ...payload.meta, count: deduped.length, page: 1, total_pages, limit },
    };
    cache.expires = Date.now() + CACHE_TTL * 1000;

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal error", details: String(err) },
      { status: 500 }
    );
  }
}

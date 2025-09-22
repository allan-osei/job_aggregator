"use client";

import { useState, useEffect } from "react";

interface Job {
  id: string | number;
  title: string;
  company: string;
  location: string;
  type: string;
  url: string;
}

// ✅ Default tokens per source for testing
const DEFAULT_TOKENS: Record<string, string> = {
  greenhouse: "stripe",
  lever: "pattern",   // correct Lever slug
  remotive: "stripe", // correct Remotive company
};

export default function HomePage() {
  const [source, setSource] = useState<keyof typeof DEFAULT_TOKENS>("greenhouse");
  const [token, setToken] = useState(DEFAULT_TOKENS["greenhouse"]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (token) {
        if (source === "lever") params.set("lever_tokens", token);
        else if (source === "greenhouse") params.set("company", token);
        else if (source === "remotive") params.set("remotive_company", token);
      }
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await fetch(`/api/${source}/jobs?${params.toString()}`);
      const data = await res.json();
      console.log("API response:", data);

      if (res.ok) {
        setJobs(data.jobs || []);
        setMeta(data.meta || {});
      } else {
        setError(data.error || "Unknown error");
        setJobs([]);
        setMeta(null);
      }
    } catch (err: any) {
      setError(String(err));
      setJobs([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Update token automatically when source changes
  useEffect(() => {
    setToken(DEFAULT_TOKENS[source]);
    setPage(1); // reset page
    fetchJobs();
  }, [source]);

  // ✅ Load initial jobs
  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Job Fetcher</h1>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          Source:{" "}
          <select
            value={source}
            onChange={(e) =>
              setSource(e.target.value as keyof typeof DEFAULT_TOKENS)
            }
          >
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="remotive">Remotive</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          Token / Company:{" "}
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="e.g. stripe, pattern"
          />
        </label>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          Page:{" "}
          <input
            type="number"
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            min={1}
          />
        </label>
        <label style={{ marginLeft: "1rem" }}>
          Limit:{" "}
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            min={1}
            max={100}
          />
        </label>
      </div>

      <button onClick={fetchJobs} disabled={loading}>
        {loading ? "Loading..." : "Fetch Jobs"}
      </button>

      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      <h2 style={{ marginTop: "2rem" }}>Results</h2>
      <p>
        Total: {meta?.total_jobs || 0} | Page: {meta?.page || 0}/
        {meta?.total_pages || 0}
      </p>

      {jobs.length === 0 ? (
        <p>No jobs found for this query.</p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                {job.title}
              </a>{" "}
              - {job.company} ({job.location}) [{job.type}]
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

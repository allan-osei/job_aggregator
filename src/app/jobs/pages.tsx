"use client";

import { useEffect, useState } from "react";

type Meta = {
  fetched_at: string;
  // add other meta properties if needed
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/greenhouse/jobs")
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs || []);
        setMeta(data.meta || null);
      })
      .catch((err) => {
        console.error(err);
        setJobs([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Aggregated Jobs (Test Environment)</h1>
      {loading ? (
        <p>Loading jobs…</p>
      ) : (
        <p>
          Found {jobs.length} jobs
          {meta ? ` — updated ${meta.fetched_at}` : ""}
        </p>
      )}
      <ul>
        {jobs.map((job) => (
          <li
            key={job.absolute_url || `${job.company}-${job.id}`}
            style={{ marginBottom: 10 }}
          >
            <a
              href={job.absolute_url}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 600 }}
            >
              {job.title}
            </a>
            <span style={{ marginLeft: 8, color: "#666" }}>
              — {job.company}
              {job.location ? ` • ${job.location}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import JobFilter from './JobFilter';
import StatCard from './StatCard';

const statusLabels = {
  applied: 'Applied',
  rejected: 'Rejected',
  further: 'Further Process',
  selected: 'Selected',
};

export default function DashboardHome({ candidates, jobs, selectedJobId, onJobChange }) {
  const counts = candidates.reduce(
    (summary, candidate) => ({
      ...summary,
      [candidate.status]: summary[candidate.status] + 1,
    }),
    { applied: 0, rejected: 0, further: 0, selected: 0 },
  );

  return (
    <section className="admin-view">
      <div className="admin-topbar">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Recruitment overview</h1>
          <p>Track applications, rejected candidates, further process, and final selections.</p>
        </div>
        <JobFilter jobs={jobs} selectedJobId={selectedJobId} onJobChange={onJobChange} />
      </div>

      <div className="stats-grid">
        <StatCard title="Total Applied" value={candidates.length} tone="blue" />
        <StatCard title={statusLabels.rejected} value={counts.rejected} tone="red" />
        <StatCard title={statusLabels.further} value={counts.further} tone="amber" />
        <StatCard title={statusLabels.selected} value={counts.selected} tone="green" />
      </div>

      <div className="dashboard-panel">
        <h2>Applications by job role</h2>
        <div className="job-summary-list">
          {jobs.map((job) => {
            const total = candidates.filter((candidate) => candidate.role === job.id).length;

            return (
              <div className="job-summary-row" key={job.id}>
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.department}</span>
                </div>
                <p>{total} candidates applied</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

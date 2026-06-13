export default function ReportsView({ candidates, jobs }) {
  return (
    <section className="admin-view">
      <div className="admin-topbar">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Recruitment reports</h1>
          <p>Simple role-wise hiring report based on current candidate data.</p>
        </div>
      </div>

      <div className="report-grid">
        {jobs.map((job) => {
          const roleCandidates = candidates.filter((candidate) => candidate.role === job.id);
          const selected = roleCandidates.filter((candidate) => candidate.status === 'selected').length;
          const rejected = roleCandidates.filter((candidate) => candidate.status === 'rejected').length;
          const further = roleCandidates.filter((candidate) => candidate.status === 'further').length;

          return (
            <article className="report-card" key={job.id}>
              <h2>{job.title}</h2>
              <p>{job.openings} openings</p>
              <div className="report-metrics">
                <span>{roleCandidates.length} applied</span>
                <span>{selected} selected</span>
                <span>{further} further</span>
                <span>{rejected} rejected</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

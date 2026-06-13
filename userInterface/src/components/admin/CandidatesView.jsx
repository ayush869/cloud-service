const statusText = {
  applied: 'Applied',
  rejected: 'Rejected',
  further: 'Further Process',
  selected: 'Selected',
};

export default function CandidatesView({ candidates, jobs, selectedJobId }) {
  const jobNameById = Object.fromEntries(jobs.map((job) => [job.id, job.title]));

  return (
    <section className="admin-view">
      <div className="admin-topbar">
        <div>
          <p className="eyebrow">Candidates</p>
          <h1>Candidate applications</h1>
          <p>
            Showing {selectedJobId === 'all' ? 'all recruitment roles' : jobNameById[selectedJobId]} candidate list.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Job Role</th>
              <th>Experience</th>
              <th>AI Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>{candidate.name}</td>
                <td>{jobNameById[candidate.role]}</td>
                <td>{candidate.experience}</td>
                <td>{candidate.score}%</td>
                <td>
                  <span className={`status-pill ${candidate.status}`}>{statusText[candidate.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function JobFilter({ jobs, selectedJobId, onJobChange }) {
  return (
    <label className="job-filter">
      Filter by recruitment role
      <select value={selectedJobId} onChange={(event) => onJobChange(event.target.value)}>
        <option value="all">All jobs</option>
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.title}
          </option>
        ))}
      </select>
    </label>
  );
}

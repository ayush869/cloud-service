import { useState } from 'react';

const emptyJob = {
  title: '',
  department: '',
  location: '',
  openings: 1,
};

export default function CreateJobView({ onCreateJob }) {
  const [job, setJob] = useState(emptyJob);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setJob((currentJob) => ({ ...currentJob, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onCreateJob(job);
    setJob(emptyJob);
  };

  return (
    <section className="admin-view narrow-view">
      <div className="admin-topbar">
        <div>
          <p className="eyebrow">Create Job</p>
          <h1>Add a new recruitment role</h1>
          <p>This job will appear in the dashboard filter and reports.</p>
        </div>
      </div>

      <form className="admin-form" onSubmit={handleSubmit}>
        <label>
          Job Title
          <input name="title" value={job.title} onChange={handleChange} placeholder="React Developer" required />
        </label>
        <label>
          Department
          <input name="department" value={job.department} onChange={handleChange} placeholder="Engineering" required />
        </label>
        <label>
          Location
          <input name="location" value={job.location} onChange={handleChange} placeholder="Remote" required />
        </label>
        <label>
          Openings
          <input name="openings" min="1" type="number" value={job.openings} onChange={handleChange} required />
        </label>
        <button className="primary-button" type="submit">
          Create Job
        </button>
      </form>
    </section>
  );
}

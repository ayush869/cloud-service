import { useMemo, useState } from 'react';
import { initialCandidates, initialJobs } from '../../data/recruitmentData';
import CandidatesView from './CandidatesView';
import CreateJobView from './CreateJobView';
import DashboardHome from './DashboardHome';
import ReportsView from './ReportsView';
import Sidebar from './Sidebar';

export default function AdminDashboard({ onLogout }) {
  const [activeView, setActiveView] = useState('dashboard');
  const [jobs, setJobs] = useState(initialJobs);
  const [candidates] = useState(initialCandidates);
  const [selectedJobId, setSelectedJobId] = useState('all');

  const filteredCandidates = useMemo(() => {
    if (selectedJobId === 'all') {
      return candidates;
    }

    return candidates.filter((candidate) => candidate.role === selectedJobId);
  }, [candidates, selectedJobId]);

  const handleCreateJob = (job) => {
    setJobs((currentJobs) => [
      ...currentJobs,
      {
        ...job,
        id: job.title.toLowerCase().replaceAll(' ', '-'),
        openings: Number(job.openings),
      },
    ]);
    setActiveView('dashboard');
  };

  const viewMap = {
    dashboard: (
      <DashboardHome
        candidates={filteredCandidates}
        jobs={jobs}
        selectedJobId={selectedJobId}
        onJobChange={setSelectedJobId}
      />
    ),
    createJob: <CreateJobView onCreateJob={handleCreateJob} />,
    candidates: <CandidatesView candidates={filteredCandidates} jobs={jobs} selectedJobId={selectedJobId} />,
    reports: <ReportsView candidates={candidates} jobs={jobs} />,
  };

  return (
    <div className="admin-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} onLogout={onLogout} />
      <main className="admin-main">{viewMap[activeView]}</main>
    </div>
  );
}

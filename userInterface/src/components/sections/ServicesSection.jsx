const services = [
  {
    title: 'AI Resume Screening',
    text: 'Compare candidate resumes with job requirements and highlight the best matches quickly.',
  },
  {
    title: 'Candidate Shortlisting',
    text: 'Create a cleaner shortlist using skills, experience, location, and role-fit signals.',
  },
  {
    title: 'Interview Planning',
    text: 'Prepare interview questions, schedule next steps, and keep candidate status easy to follow.',
  },
  {
    title: 'Hiring Analytics',
    text: 'Track pipeline progress, recruiter activity, and role performance from one simple view.',
  },
];

export default function ServicesSection() {
  return (
    <section className="content-section section-shell" id="services">
      <div className="section-heading">
        <p className="eyebrow">Services</p>
        <h2>Everything needed to recruit with AI</h2>
      </div>

      <div className="service-grid">
        {services.map((service) => (
          <article className="service-card" key={service.title}>
            <h3>{service.title}</h3>
            <p>{service.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function StatCard({ title, value, tone }) {
  return (
    <article className={`stat-card ${tone}`}>
      <p>{title}</p>
      <strong>{value}</strong>
    </article>
  );
}

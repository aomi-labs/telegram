export function Unmapped({ title }: { title: string }) {
  return (
    <div className="card">
      <div className="kicker">Not connected</div>
      <p>Set up your agent on the {title} web app first, then come back here.</p>
    </div>
  );
}

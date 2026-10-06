export const URG = { HIGH: "High", MODERATE: "Moderate", ROUTINE: "Routine" };
export const STATUS = { waiting: "Waiting", in_consultation: "In consultation", completed: "Completed" };

export function UrgencyBadge({ level, label, big }) {
  return <span className={`urg u-${level} ${big ? "big" : ""}`}>{label || level}</span>;
}
export function StatusBadge({ status, label }) {
  return <span className={`stat st-${status}`}>{label || STATUS[status] || status}</span>;
}
export const Disclaimer = ({ children }) => <p className="disc">{children}</p>;

const STYLES = {
  requested: 'bg-amber-50 text-amber-700',
  accepted: 'bg-blue-50 text-blue-700',
  ongoing: 'bg-brand-50 text-brand-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-50 text-red-600',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STYLES[status] ?? STYLES.completed}`}>
      {status}
    </span>
  );
}

import { Check } from 'lucide-react';

const STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'ongoing', label: 'On trip' },
  { key: 'completed', label: 'Completed' },
];

export default function RideProgress({ status }) {
  const current = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex items-center">
      {STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  done ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`text-[11px] ${done ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 mb-4 h-0.5 flex-1 ${i < current ? 'bg-brand-500' : 'bg-gray-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

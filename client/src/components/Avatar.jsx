export default function Avatar({ user, size = 'h-9 w-9' }) {
  if (user?.avatar) {
    return <img src={user.avatar} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover`} />;
  }
  const initials = (user?.name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className={`${size} flex items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700`}>
      {initials}
    </span>
  );
}

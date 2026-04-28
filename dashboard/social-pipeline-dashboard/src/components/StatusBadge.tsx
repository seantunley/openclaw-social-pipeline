import { cn, formatStatus, statusColor } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useT();
  const key = `runs.status.${status}`;
  const translated = t(key);
  const label = translated === key ? formatStatus(status) : translated;
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        statusColor(status),
        className
      )}
    >
      {label}
    </span>
  );
}

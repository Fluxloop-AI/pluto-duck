'use client';

import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface ProfileCardProps {
  name?: string | null;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onClick?: () => void;
}

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export function ProfileCard({
  name,
  subtitle,
  avatarUrl,
  onClick,
}: ProfileCardProps) {
  const t = useTranslations('profile');
  const trimmedName = name?.trim() ?? '';
  const isLoggedIn = trimmedName.length > 0;
  const primaryText = isLoggedIn ? trimmedName : t('login');
  const secondaryText = subtitle ?? t('defaultEmail');
  const initials = isLoggedIn ? getInitials(trimmedName) : '?';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl bg-transparent pl-1 pr-3 py-3 text-left transition-colors hover:bg-black/10"
      aria-label={t('openSettings')}
    >
      <Avatar className="h-10 w-10 bg-white text-sm">
        <AvatarImage alt="" src={avatarUrl || undefined} />
        <AvatarFallback className="bg-white text-foreground">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {primaryText}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {secondaryText}
        </span>
      </div>
    </button>
  );
}

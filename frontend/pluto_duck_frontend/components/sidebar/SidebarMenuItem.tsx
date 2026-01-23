'use client';

import type { ReactNode } from 'react';

interface SidebarMenuItemProps {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}

export function SidebarMenuItem({
  icon,
  label,
  isActive,
  onClick,
}: SidebarMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 py-2 pl-[18px] pr-[14px] transition-colors ${
        isActive
          ? 'bg-black/5 font-medium'
          : 'hover:bg-black/5'
      }`}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className={`text-sm ${isActive ? 'text-foreground' : 'text-foreground'}`}>
        {label}
      </span>
    </button>
  );
}

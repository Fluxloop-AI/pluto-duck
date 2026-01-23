'use client';

import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface SidebarSectionProps {
  icon?: ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  onAddClick?: () => void;
  children?: ReactNode;
}

export function SidebarSection({
  icon,
  label,
  isActive,
  onClick,
  onAddClick,
  children,
}: SidebarSectionProps) {
  return (
    <div>
      <div
        className={`flex items-center justify-between py-1 pl-[18px] pr-[14px] ${
          onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
        }`}
        onClick={onClick}
        onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span
            className={`text-sm font-medium ${
              isActive ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {label}
          </span>
        </div>
        {onAddClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddClick();
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-200 transition-colors"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      {children && <div className="px-[14px]">{children}</div>}
    </div>
  );
}

'use client';

import { Fragment, useState } from 'react';
import { AtSignIcon, SearchIcon, ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAssetMentions, type MentionItem } from '@/hooks/useAssetMentions';

interface MentionMenuProps {
  projectId: string;
  onSelect: (item: MentionItem) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MentionMenu({ projectId, onSelect, open, onOpenChange }: MentionMenuProps) {
  const { mentionGroups, isLoading, getIcon } = useAssetMentions(projectId);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = mentionGroups.map(group => ({
    ...group,
    items: group.items.filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(group => group.items.length > 0);

  const hasItems = filteredGroups.some(g => g.items.length > 0);

  const renderIcon = (type: MentionItem['type']) => {
    const Icon = getIcon(type);
    return <Icon className="h-3 w-3 mr-2 text-muted-foreground" />;
  };

  return (
    <DropdownMenu open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) setSearchQuery(''); // Reset search on close
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 border-none bg-transparent px-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          title="Mention asset"
        >
          <AtSignIcon className="h-2 w-2" />
          <span>Context</span>
          <ChevronDownIcon className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto p-0">
        <div className="sticky top-0 bg-popover p-2 border-b z-10">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-muted/50 border-none focus-visible:ring-1"
              autoFocus
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Loading assets...
          </div>
        ) : !hasItems ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No assets found
          </div>
        ) : (
          <div className="py-1">
            {filteredGroups.map((group, groupIndex) => (
              <Fragment key={group.label}>
                {groupIndex > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground px-2 py-1.5">
                  {group.label}
                </DropdownMenuLabel>
                {group.items.map((item) => (
                  <DropdownMenuItem
                    key={`${item.type}-${item.id}`}
                    onSelect={() => onSelect(item)}
                    className="text-xs px-2 py-1.5 cursor-pointer"
                  >
                    {renderIcon(item.type)}
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{item.name}</span>
                      {item.description && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {item.description}
                        </span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';

interface AssetTableViewProps {
  columns: string[];
  rows: any[][];
  totalRows: number;
  initialRows?: number;
  increment?: number;
  alwaysShowSearch?: boolean;
  hideFooter?: boolean;
}

interface MatchPosition {
  rowIndex: number;
  cellIndex: number;
}

export function AssetTableView({
  columns,
  rows,
  totalRows,
  initialRows = 10,
  increment = 10,
  alwaysShowSearch = false,
  hideFooter = false,
}: AssetTableViewProps) {
  // Visible rows state (Show More pattern)
  const [visibleRowCount, setVisibleRowCount] = useState(initialRows);

  // Row selection state
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchPositions, setMatchPositions] = useState<MatchPosition[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Calculate displayed rows
  const displayedRows = useMemo(
    () => rows.slice(0, visibleRowCount),
    [rows, visibleRowCount]
  );

  const hasMoreRows = visibleRowCount < rows.length;
  const remainingRows = rows.length - visibleRowCount;

  // Format cell value
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '-';
    }
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (value instanceof Date) {
      return value.toLocaleDateString();
    }
    return String(value);
  };

  // Handle Show More
  const handleShowMore = useCallback(() => {
    setVisibleRowCount((prev) => Math.min(prev + increment, rows.length));
  }, [increment, rows.length]);

  // Handle row click
  const handleRowClick = useCallback((index: number) => {
    setSelectedRowIndex((prev) => (prev === index ? null : index));
  }, []);

  // Calculate match positions when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatchPositions([]);
      setCurrentMatchIndex(0);
      return;
    }

    const query = searchQuery.toLowerCase();
    const positions: MatchPosition[] = [];

    displayedRows.forEach((row, rowIndex) => {
      row.forEach((cell, cellIndex) => {
        const cellValue = formatValue(cell).toLowerCase();
        if (cellValue.includes(query)) {
          positions.push({ rowIndex, cellIndex });
        }
      });
    });

    setMatchPositions(positions);
    setCurrentMatchIndex(0);
  }, [searchQuery, displayedRows]);

  // Derived state: show search bar
  const showSearch = alwaysShowSearch || isSearchOpen;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F or Cmd+F to focus/open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const tableContainer = tableContainerRef.current;
        if (tableContainer) {
          const isTableFocused = tableContainer.contains(document.activeElement);
          const isTableHovered = tableContainer.matches(':hover');

          if (isTableFocused || isTableHovered || showSearch) {
            e.preventDefault();
            if (!alwaysShowSearch) {
              setIsSearchOpen(true);
            }
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }
        }
      }

      // ESC to close search (only when not alwaysShowSearch)
      if (e.key === 'Escape' && isSearchOpen && !alwaysShowSearch) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }

      // Enter to go to next match, Shift+Enter for previous
      if (e.key === 'Enter' && showSearch && matchPositions.length > 0 && document.activeElement === searchInputRef.current) {
        e.preventDefault();
        if (e.shiftKey) {
          setCurrentMatchIndex((prev) =>
            prev === 0 ? matchPositions.length - 1 : prev - 1
          );
        } else {
          setCurrentMatchIndex((prev) =>
            prev === matchPositions.length - 1 ? 0 : prev + 1
          );
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, isSearchOpen, alwaysShowSearch, matchPositions.length]);

  // Navigate to previous match
  const goToPreviousMatch = useCallback(() => {
    if (matchPositions.length === 0) return;
    setCurrentMatchIndex((prev) =>
      prev === 0 ? matchPositions.length - 1 : prev - 1
    );
  }, [matchPositions.length]);

  // Navigate to next match
  const goToNextMatch = useCallback(() => {
    if (matchPositions.length === 0) return;
    setCurrentMatchIndex((prev) =>
      prev === matchPositions.length - 1 ? 0 : prev + 1
    );
  }, [matchPositions.length]);

  // Close search (only used when not alwaysShowSearch)
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  // Check if a cell matches the search
  const getCellMatchState = (rowIndex: number, cellIndex: number): 'none' | 'match' | 'current' => {
    if (!searchQuery.trim() || matchPositions.length === 0) return 'none';

    const matchIndex = matchPositions.findIndex(
      (pos) => pos.rowIndex === rowIndex && pos.cellIndex === cellIndex
    );

    if (matchIndex === -1) return 'none';
    if (matchIndex === currentMatchIndex) return 'current';
    return 'match';
  };

  // Get cell highlight class
  const getCellHighlightClass = (matchState: 'none' | 'match' | 'current'): string => {
    switch (matchState) {
      case 'current':
        return 'bg-yellow-300/60 dark:bg-yellow-500/40';
      case 'match':
        return 'bg-yellow-200/40 dark:bg-yellow-500/20';
      default:
        return '';
    }
  };

  return (
    <div ref={tableContainerRef} className="space-y-3" tabIndex={-1}>
      {/* Search Bar */}
      {showSearch && (
        <div className={`flex items-center gap-2 p-2 rounded-lg bg-muted/30 ${!alwaysShowSearch ? 'border border-border' : ''}`}>
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in table..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            autoFocus={!alwaysShowSearch}
          />
          {matchPositions.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {currentMatchIndex + 1} / {matchPositions.length}
            </span>
          )}
          {searchQuery && matchPositions.length === 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              No matches
            </span>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={goToPreviousMatch}
              disabled={matchPositions.length === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={goToNextMatch}
              disabled={matchPositions.length === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next match (Enter)"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          {!alwaysShowSearch && (
            <button
              onClick={closeSearch}
              className="p-1 rounded hover:bg-muted transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="border-y border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No data
                  </td>
                </tr>
              ) : (
                displayedRows.map((row, rowIndex) => {
                  const isSelected = selectedRowIndex === rowIndex;
                  return (
                    <tr
                      key={rowIndex}
                      onClick={() => handleRowClick(rowIndex)}
                      className={`
                        border-t border-border/50 cursor-pointer transition-colors
                        ${isSelected
                          ? 'bg-primary/10 hover:bg-primary/15'
                          : 'hover:bg-muted/30'
                        }
                      `}
                    >
                      {row.map((cell, cellIndex) => {
                        const matchState = getCellMatchState(rowIndex, cellIndex);
                        const highlightClass = getCellHighlightClass(matchState);
                        const formattedValue = formatValue(cell);
                        const isNullish = cell === null || cell === undefined;

                        return (
                          <td
                            key={cellIndex}
                            className={`px-4 py-2.5 text-sm whitespace-nowrap ${highlightClass}`}
                          >
                            {isNullish ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              formattedValue
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Show More / Status */}
      {!hideFooter && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {displayedRows.length} of {rows.length} rows
            {totalRows > rows.length && ` (${totalRows.toLocaleString()} total)`}
          </span>
          {hasMoreRows && (
            <button
              onClick={handleShowMore}
              className="px-3 py-1.5 rounded-md border border-border hover:bg-muted hover:border-foreground/20 transition-colors"
            >
              Show {Math.min(increment, remainingRows)} more rows
            </button>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, PlusIcon } from 'lucide-react';
import type { ProjectListItem } from '../../lib/projectsApi';

interface ProjectSelectorProps {
  currentProject: ProjectListItem | null;
  projects: ProjectListItem[];
  onSelectProject: (project: ProjectListItem) => void;
  onNewProject: () => void;
}

export function ProjectSelector({
  currentProject,
  projects,
  onSelectProject,
  onNewProject,
}: ProjectSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  const handleSelectProject = (project: ProjectListItem) => {
    onSelectProject(project);
    setShowDropdown(false);
  };

  const handleNewProject = () => {
    onNewProject();
    setShowDropdown(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 hover:text-primary transition-colors group"
      >
        <h2 className="text-xs font-semibold truncate">
          {currentProject?.name || 'My Workspace'}
        </h2>
        <ChevronDown className="h-3 w-3 opacity-50 group-hover:opacity-100" />
      </button>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 mt-2 w-80 max-h-96 overflow-y-auto bg-popover border border-border rounded-md shadow-lg z-50"
        >
          {projects.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No projects found
            </div>
          ) : (
            <div className="py-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className={`w-full px-3 py-2 text-left hover:bg-accent transition-colors ${
                    currentProject?.id === project.id ? 'bg-accent/50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-medium truncate">
                          {project.name}
                        </div>
                        {project.is_default && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                            Default
                          </span>
                        )}
                      </div>
                      {project.description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {project.description}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span>{project.board_count} board{project.board_count !== 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span>{project.conversation_count} chat{project.conversation_count !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border">
            <button
              onClick={handleNewProject}
              className="w-full px-3 py-2 text-left hover:bg-accent transition-colors flex items-center gap-2 text-xs font-medium text-primary"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


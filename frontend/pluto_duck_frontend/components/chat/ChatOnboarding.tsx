'use client';

import { type LucideIcon, TextSearch, Calculator, ChartSpline, Layers } from 'lucide-react';

interface OnboardingOption {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
}

const ONBOARDING_OPTIONS: OnboardingOption[] = [
  {
    id: 'explore',
    label: 'Explore Data',
    description: 'Browse and discover your datasets',
    prompt: 'Help me explore my data. Show me an overview of all available tables and suggest interesting insights.',
    icon: TextSearch,
  },
  {
    id: 'analyze',
    label: 'Run Analysis',
    description: 'Find patterns and trends',
    prompt: 'I want to run an analysis on my data. Help me identify patterns and trends.',
    icon: Calculator,
  },
  {
    id: 'generate-dashboard',
    label: 'Generate Dashboard',
    description: 'Create visualizations',
    prompt: 'Help me create a dashboard. What visualizations would be most useful for my data?',
    icon: ChartSpline,
  },
  {
    id: 'update-dashboard',
    label: 'Update Dashboard',
    description: 'Improve existing views',
    prompt: 'I need to update my existing dashboard. Show me the current visualizations and suggest improvements.',
    icon: Layers,
  },
];

interface OnboardingCardProps {
  option: OnboardingOption;
  onSelect: (prompt: string) => void;
}

function OnboardingCard({ option, onSelect }: OnboardingCardProps) {
  const Icon = option.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(option.prompt)}
      className="group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center transition hover:border-primary/60 hover:bg-accent cursor-pointer"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary/20">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="text-sm font-medium">{option.label}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
      </div>
    </button>
  );
}

interface ChatOnboardingProps {
  onSelect: (prompt: string) => void;
}

export function ChatOnboarding({ onSelect }: ChatOnboardingProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pt-6 pb-10 -mt-4">
      <h2 className="text-xl font-semibold mb-2">Hello!</h2>
      <p className="text-muted-foreground mb-6 text-center">
        What would you like to do
        <br />
        with your data today?
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        {ONBOARDING_OPTIONS.map(option => (
          <OnboardingCard
            key={option.id}
            option={option}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

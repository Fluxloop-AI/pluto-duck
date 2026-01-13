"use client";

import { cn } from "@/lib/utils";
import { memo, useEffect, useState } from "react";

const ACTIVITY_TEXTS = [
  "Analyzing...",
  "Searching...",
  "Processing...",
  "Exploring...",
  "Reviewing...",
  "Examining...",
  "Investigating...",
  "Gathering...",
];

const TYPING_SPEED = 80; // ms per character
const PAUSE_AFTER_COMPLETE = 1500; // ms to wait after text is fully typed

export type ActivityLoaderProps = {
  className?: string;
  texts?: string[];
  typingSpeed?: number;
  pauseDuration?: number;
};

export const ActivityLoader = memo(
  ({
    className,
    texts = ACTIVITY_TEXTS,
    typingSpeed = TYPING_SPEED,
    pauseDuration = PAUSE_AFTER_COMPLETE,
  }: ActivityLoaderProps) => {
    const [textIndex, setTextIndex] = useState(0);
    const [charIndex, setCharIndex] = useState(0);
    const [isTyping, setIsTyping] = useState(true);

    const currentText = texts[textIndex];
    const displayText = currentText.slice(0, charIndex);

    useEffect(() => {
      if (isTyping) {
        // Typing phase
        if (charIndex < currentText.length) {
          const timer = setTimeout(() => {
            setCharIndex((prev) => prev + 1);
          }, typingSpeed);
          return () => clearTimeout(timer);
        } else {
          // Finished typing, start pause
          setIsTyping(false);
        }
      } else {
        // Pause phase, then move to next text
        const timer = setTimeout(() => {
          setTextIndex((prev) => (prev + 1) % texts.length);
          setCharIndex(0);
          setIsTyping(true);
        }, pauseDuration);
        return () => clearTimeout(timer);
      }
    }, [charIndex, currentText.length, isTyping, texts.length, typingSpeed, pauseDuration]);

    return (
      <div className={cn("flex items-center gap-3", className)}>
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/50" />
          <span className="relative inline-flex size-2 rounded-full bg-muted-foreground" />
        </span>
        <span className="text-sm text-muted-foreground">
          {displayText}
          <span className="animate-pulse">|</span>
        </span>
      </div>
    );
  }
);

ActivityLoader.displayName = "ActivityLoader";

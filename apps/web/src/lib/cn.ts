/**
 * `cn` — tiny conditional class-name joiner.
 *
 * Wraps `clsx` so consumers import a single helper. Kept here (and not
 * inline in components) so the dependency switch (clsx → twMerge → cva)
 * is a one-line change.
 */
import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}

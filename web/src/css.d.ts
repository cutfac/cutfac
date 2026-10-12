import "react";

declare module "react" {
  /** Custom properties, so inline styles can hand positions to Tailwind's `left-(--x)` classes. */
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}

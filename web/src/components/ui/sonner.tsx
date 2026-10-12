import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// `theme="system"` follows prefers-color-scheme, which is also what main.tsx uses for the
// `dark` class, so the toasts always match the page.
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="system"
    className="group [--border-radius:var(--radius-2xl)] [--normal-bg:var(--popover)] [--normal-border:var(--border)] [--normal-text:var(--popover-foreground)]"
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
      loading: <Loader2Icon className="size-4 animate-spin" />,
    }}
    {...props}
  />
);

export { Toaster };

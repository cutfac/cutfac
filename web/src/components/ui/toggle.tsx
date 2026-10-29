import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-2xl text-sm font-medium whitespace-nowrap transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-pressed:bg-foreground/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Quiet until picked, as the Codex app's segmented controls are.
        default: "bg-transparent text-muted-foreground aria-pressed:text-foreground",
        // Filled rather than edged, like the outline button; picked ones fill deeper.
        outline:
          "bg-foreground/6 hover:bg-foreground/10 focus-visible:bg-foreground/10 aria-pressed:bg-foreground/16 aria-pressed:text-foreground",
        // One of several to pick, as filter chips do: picked ones take the brand's edge and tint.
        choice:
          "bg-foreground/6 text-muted-foreground ring-brand hover:bg-foreground/10 focus-visible:bg-foreground/10 aria-pressed:bg-brand/12 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:hover:bg-brand/16",
        // A row of a list to pick one from, its label wrapping in full, as a radio list's rows do.
        row: "w-full justify-start text-left font-normal whitespace-normal text-muted-foreground aria-pressed:bg-brand/10 aria-pressed:text-foreground aria-pressed:hover:bg-brand/14",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        row: "min-h-9 gap-2.5 px-2.5 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };

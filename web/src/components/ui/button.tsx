import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-2xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // A primary action that can't run yet goes gray, so the one gold button is always one to press.
        default:
          "bg-brand text-brand-foreground hover:bg-brand/85 focus-visible:bg-brand/85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        // A light fill with no edge, as the Codex app draws its buttons.
        outline:
          "bg-foreground/6 hover:bg-foreground/10 focus-visible:bg-foreground/10 aria-expanded:bg-foreground/10",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:bg-destructive/30",
        // A way out that shouldn't be pressed by mistake: muted text, a fill only on hover.
        quiet:
          "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline focus-visible:underline",
        // A light fill with no edge, for the chips and actions that sit among the chat's messages.
        soft: "bg-foreground/8 hover:bg-foreground/12 focus-visible:bg-foreground/12 aria-expanded:bg-foreground/12",
      },
      pill: {
        true: "rounded-full",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  pill,
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, pill, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

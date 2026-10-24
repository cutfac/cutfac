import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors outline-none after:absolute after:-inset-x-2 after:-inset-y-1.5 focus-visible:ring-3 focus-visible:ring-ring/50 data-readonly:pointer-events-none data-checked:bg-primary data-checked:hover:bg-primary/80 data-unchecked:bg-input data-unchecked:hover:bg-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full shadow-sm transition-transform data-checked:translate-x-4 data-checked:bg-primary-foreground data-unchecked:translate-x-0 data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

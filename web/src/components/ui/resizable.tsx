import { cva, type VariantProps } from "class-variance-authority";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

const handleVariants = cva(
  "relative flex shrink-0 items-center justify-center outline-hidden focus-visible:ring-1 focus-visible:ring-ring [&[aria-orientation=horizontal]>div]:rotate-90",
  {
    variants: {
      variant: {
        // A line between two panels. What it takes a pointer over is as wide as the area the
        // panel library drags it from, and above the panels' content, so a double-click there
        // reaches it too.
        line: "z-10 w-px bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 data-[separator=active]:bg-dock data-[separator=hover]:bg-dock",
        // A gap between two panels, which draws its line only while it is pointed at or dragged.
        gap: "w-3 rounded-full before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full aria-[orientation=horizontal]:h-3 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1/2 aria-[orientation=horizontal]:before:bottom-auto aria-[orientation=horizontal]:before:h-0.5 aria-[orientation=horizontal]:before:w-auto aria-[orientation=horizontal]:before:translate-x-0 aria-[orientation=horizontal]:before:-translate-y-1/2 data-[separator=active]:before:bg-dock data-[separator=hover]:before:bg-dock data-[separator=active]:[&>div]:bg-dock data-[separator=hover]:[&>div]:bg-dock",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

function ResizableHandle({
  withHandle,
  variant,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps &
  VariantProps<typeof handleVariants> & {
    withHandle?: boolean;
  }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      data-variant={variant ?? "line"}
      className={cn(handleVariants({ variant }), className)}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };

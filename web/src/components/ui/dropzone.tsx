import { useImperativeHandle, type ClipboardEvent, type ComponentProps, type Ref } from "react";
import { useDropzone, type FileWithPath } from "react-dropzone";

import { cn } from "@/lib/utils";

/** A file the user dropped, pasted or picked. */
export interface DroppedFile {
  readonly file: File;
  /** `logo.png`, or `photos/2024/a.jpg` for a file inside a dropped folder. */
  readonly path: string;
}

/** Where the file sat in the drop, without the `./` or `/` react-dropzone puts before it. */
function pathOf(file: File) {
  // SAFETY: react-dropzone reads every drop, paste and pick through file-selector, which records
  // the path on each file.
  const { relativePath } = file as FileWithPath;

  return relativePath.replace(/^\.?\//, "");
}

/** Rich text copied from a page or a document can carry a picture of itself; it pastes as text. */
const richText = (event: ClipboardEvent<HTMLElement>) =>
  event.clipboardData.types.includes("text/html") &&
  event.clipboardData.getData("text/plain").trim() !== "";

interface DropzoneProps extends Omit<ComponentProps<"div">, "ref" | "onPaste"> {
  onFiles: (files: DroppedFile[]) => void;
  /** What a drop here does, shown on the area while files are dragged over the window. */
  label: string;
  disabled?: boolean;
  /** Take files pasted into the area too, as Cmd+V does in a chat box. */
  paste?: boolean;
  /** Set to a function that opens the file picker. */
  openRef?: Ref<() => void>;
  /** The kinds of file the picker offers, as in `<input accept>`; a drop takes any file. */
  accept?: string | undefined;
  /** Whether the picker takes more than one file. */
  multiple?: boolean | undefined;
}

/**
 * An area that takes files from the desktop. While files are dragged over the window every area
 * shows a dashed outline with what a drop does there, and the one under the cursor lights up.
 * Areas must not nest: each tracks the drag on its own.
 */
function Dropzone({
  onFiles,
  label,
  disabled = false,
  paste = false,
  openRef,
  accept,
  multiple = true,
  className,
  children,
  ...props
}: DropzoneProps) {
  const { getRootProps, getInputProps, isDragActive, isDragGlobal, open } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) onFiles(files.map((file) => ({ file, path: pathOf(file) })));
    },
    disabled,
    noClick: true,
    noKeyboard: true,
    noPaste: !paste,
  });

  useImperativeHandle(openRef, () => open, [open]);

  const drag = disabled ? undefined : isDragActive ? "over" : isDragGlobal ? "near" : undefined;

  return (
    <div
      {...getRootProps({
        ...props,
        className: cn("group/drop relative", className),
        onPaste: (event: ClipboardEvent<HTMLElement>) => {
          // Stopping it here keeps the drop area from taking the copied text as a picture.
          if (richText(event)) event.stopPropagation();
        },
      })}
      data-slot="dropzone"
      data-drop-target=""
      data-drag={drag}
    >
      <input {...getInputProps({ accept, multiple })} />
      {children}
      <div
        aria-hidden="true"
        data-slot="dropzone-overlay"
        className="pointer-events-none absolute inset-0 z-30 hidden items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/70 p-2 group-data-[drag=near]/drop:flex group-data-[drag=over]/drop:flex group-data-[drag=over]/drop:border-solid group-data-[drag=over]/drop:border-primary group-data-[drag=over]/drop:bg-primary/15"
      >
        <span className="max-w-full truncate rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-foreground/10 group-data-[drag=over]/drop:text-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

export { Dropzone };

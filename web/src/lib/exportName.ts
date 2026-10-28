const ASPECT_TAG = /^\[(\d+x\d+)\]\s*/;

/**
 * What Export suggests saving `file` as: the video's title, which the agent keeps up to date, rather
 * than a file name taken from the first words of the request. The aspect follows when the video has
 * several files. `[9x16] demo.mp4` of "Launch" saves as `Launch.mp4`, or `Launch 9x16.mp4`.
 */
export function exportName(title: string, file: string, several: boolean): string {
  const base = file.split("/").at(-1) ?? file;
  const extension = /\.[^.]+$/.exec(base)?.[0] ?? "";
  const aspect = ASPECT_TAG.exec(base)?.[1];
  const name = title.trim().replaceAll(/\s*[/\\:]\s*/g, " - ");

  if (name === "") return base.replace(ASPECT_TAG, "");

  return `${name}${several && aspect !== undefined ? ` ${aspect}` : ""}${extension}`;
}

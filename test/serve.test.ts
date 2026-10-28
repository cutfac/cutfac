import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli.ts");

const freePort = () => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;

  probe.stop(true);

  return port;
};

const answers = (url: string) =>
  fetch(url).then(
    (response) => response.ok,
    () => false,
  );

async function untilAnswers(url: string) {
  for (let tries = 0; tries < 100; tries++) {
    if (await answers(url)) return;
    await Bun.sleep(100);
  }

  throw new Error(`${url} never answered`);
}

test("the server stops soon after SIGTERM while the board listens for changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "cutfac-serve-"));
  const workspace = join(home, "ws");
  const env = { ...process.env, HOME: home };
  const port = String(freePort());

  try {
    await Bun.spawn(["bun", CLI, "init", "--no-connect", workspace], { env, stdout: "ignore" })
      .exited;

    const server = Bun.spawn(
      ["bun", CLI, "serve", "--workspace", workspace, "--port", port, "--host", "127.0.0.1"],
      { env, stdout: "ignore", stderr: "ignore" },
    );

    await untilAnswers(`http://127.0.0.1:${port}/api/health`);

    expect((await fetch(`http://127.0.0.1:${port}/api/events`)).ok).toBe(true);

    server.kill("SIGTERM");

    const stopped = await Promise.race([
      server.exited.then(() => "stopped"),
      Bun.sleep(2500).then(() => "still running"),
    ]);

    server.kill("SIGKILL");

    expect(stopped).toBe("stopped");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

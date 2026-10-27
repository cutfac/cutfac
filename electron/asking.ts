export interface Asking {
  readonly id: string;
  readonly title: string;
  readonly about: "approval" | "question";
}

export const askingKey = ({ about, id }: Asking) => `${about} ${id}`;

export const askingChanges = (
  before: ReadonlySet<string>,
  asking: ReadonlyArray<Asking>,
  away: boolean,
) => ({
  notify: away ? asking.filter((ask) => !before.has(askingKey(ask))) : [],
  now: new Set(asking.map(askingKey)),
});

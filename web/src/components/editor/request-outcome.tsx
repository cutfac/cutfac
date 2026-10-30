import { Option } from "effect";
import { CheckIcon, HistoryIcon, MessageSquareReplyIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { Feedback, ItemDetail } from "../../api.ts";
import { useMessages, type Messages } from "../../i18n/index.ts";
import { pointOf } from "../../lib/history.ts";
import { ORIGINAL, savedVersions, versionsMedia, versionsOf } from "../../lib/requests.ts";
import { Reply } from "./agent-question.tsx";
import { CompareDialog } from "./compare-dialog.tsx";
import type { RequestActions } from "./request.tsx";
import { type ChooseVersion, VersionSwitcher } from "./version-switcher.tsx";

/** The file a request was about, named only when the item has others to tell it from. */
export const namedFile = (item: ItemDetail, media: string) =>
  item.media.length > 1 ? Option.some(media) : Option.none<string>();

/** The agent's result: the versions to pick from, or the edit to keep or roll back. */
export function Result({
  item,
  feedback,
  actions,
}: {
  item: ItemDetail;
  feedback: Feedback;
  actions: RequestActions;
}) {
  const t = useMessages();
  const versions = versionsOf(feedback);

  if (versions.length > 0) {
    return (
      <div className="flex flex-col gap-2.5 rounded-5xl bg-card p-3 squircle">
        <p className="text-sm">
          {t.chat.versionsReady(
            versions.length,
            feedback.variants?.wanted,
            Option.getOrUndefined(
              Option.flatMap(versionsMedia(feedback), (media) => namedFile(item, media)),
            ),
          )}
        </p>
        <VersionSwitcher
          item={item}
          feedback={feedback}
          onOpen={actions.compare}
          onChoose={chooser(feedback, actions)}
        >
          <Button variant="ghost" pill size="xs" onClick={() => actions.retarget(feedback)}>
            <MessageSquareReplyIcon data-icon="inline-start" />
            {t.chat.askAgain}
          </Button>
        </VersionSwitcher>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-5xl bg-card p-3 squircle">
      <p className="text-sm">
        {t.chat.edited(
          Option.getOrUndefined(
            Option.flatMap(Option.fromUndefinedOr(feedback.media), (media) =>
              namedFile(item, media),
            ),
          ),
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CompareDialog
          item={item}
          feedback={feedback}
          onOpen={actions.compare}
          onApprove={() => actions.approve(feedback)}
          onRestore={() => actions.restore(feedback)}
        />
        <Button pill size="xs" onClick={() => actions.approve(feedback)}>
          <CheckIcon data-icon="inline-start" />
          {t.chat.keep}
        </Button>
        <Button variant="soft" pill size="xs" onClick={() => actions.restore(feedback)}>
          <Undo2Icon data-icon="inline-start" />
          {t.chat.restore}
        </Button>
        <Button variant="ghost" pill size="xs" onClick={() => actions.retarget(feedback)}>
          <MessageSquareReplyIcon data-icon="inline-start" />
          {t.chat.askAgain}
        </Button>
      </div>
    </div>
  );
}

/** Choosing among a request's versions: the original rolls back, a version is picked. */
const chooser =
  (feedback: Feedback, actions: RequestActions): ChooseVersion =>
  (choice) =>
    choice === ORIGINAL ? actions.restore(feedback) : actions.pick(feedback, choice);

/** The badge for a decision on a request: kept, rolled back, or no version kept. */
function decisionBadge(feedback: Feedback, t: Messages) {
  const picked = feedback.variants?.picked;

  if (feedback.decision === "approved") {
    return {
      icon: CheckIcon,
      text: picked === undefined ? t.chat.kept : t.chat.keptVersion(picked),
    };
  }

  const text =
    picked !== undefined
      ? t.chat.rolledBackVersion(picked)
      : feedback.variants === undefined
        ? t.chat.rolledBackBadge
        : t.chat.keptNone;

  return { icon: Undo2Icon, text };
}

/** How the request ended: the versions to switch between, kept or rolled back, or a note. */
export function Outcome({
  item,
  feedback,
  replied,
  actions,
}: {
  item: ItemDetail;
  feedback: Feedback;
  replied: boolean;
  actions: RequestActions;
}) {
  const t = useMessages();

  // Once later changes moved the media on, a kept request can put back what it left.
  const point = Option.getOrUndefined(pointOf(item.history, feedback));

  const back =
    point === undefined ? null : (
      <BackTo running={item.running} onBack={() => actions.backTo(feedback, point)} />
    );

  // Versions decided on stay to switch between, and the row says which one is in.
  if (feedback.decision !== undefined && savedVersions(feedback).length > 0) {
    return (
      <VersionSwitcher
        item={item}
        feedback={feedback}
        onOpen={actions.compare}
        onChoose={chooser(feedback, actions)}
      >
        {back}
      </VersionSwitcher>
    );
  }

  if (feedback.decision !== undefined) {
    const { icon: Icon, text } = decisionBadge(feedback, t);

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" pill>
          <Icon data-icon="inline-start" />
          {text}
        </Badge>
        {back}
      </div>
    );
  }

  if (feedback.status === "resolved" && feedback.resolution !== undefined && !replied) {
    return <Reply text={feedback.resolution} />;
  }

  return null;
}

/** Back to the moment a kept request left the video in, past the changes made since. */
function BackTo({ running, onBack }: { running: boolean; onBack: () => Promise<void> }) {
  const t = useMessages();
  const [going, setGoing] = useState(false);

  return (
    <Button
      variant="ghost"
      pill
      size="xs"
      title={t.chat.backToHint}
      disabled={running || going}
      onClick={() => {
        setGoing(true);
        void onBack().finally(() => setGoing(false));
      }}
    >
      {going ? <Spinner data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}
      {t.chat.backTo}
    </Button>
  );
}

import { Option } from "effect";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

const displayName = Option.liftThrowable((locale: string) =>
  LANGUAGE_NAMES.of(new Intl.Locale(locale).language),
);

/** The English name of a locale's language, such as "Korean" for `ko-KR`; none for a bad tag. */
export const languageName = (locale: string) =>
  Option.flatMap(displayName(locale), Option.fromNullishOr);

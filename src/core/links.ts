/**
 * Query or fragment parameters whose name says they hold a secret, compared in lower case without
 * `-` and `_`. Signed links (`X-Amz-Signature`, Dropbox's `rlkey`) are meant to be shared and pass.
 */
const SECRET_PARAMS = new Set([
  "token",
  "accesstoken",
  "authtoken",
  "apitoken",
  "idtoken",
  "refreshtoken",
  "privatetoken",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "apikey",
  "secretkey",
  "privatekey",
]);

/**
 * Tokens with a format no ordinary link has: GitHub, GitLab, Slack, Anthropic, OpenAI, Stripe,
 * Google, Hugging Face, and npm. Their characters are never percent-encoded.
 */
const TOKEN =
  /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}|glpat-[\w-]{20}|xox[abposr]-[\w-]{10,}|sk-ant-[\w-]{20,}|sk-proj-[\w-]{20,}|[rs]k_live_[A-Za-z0-9]{20,}|AIza[\w-]{35}|hf_[A-Za-z0-9]{34}|npm_[A-Za-z0-9]{36})/;

const params = (url: URL) => [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))];

/**
 * Whether a link carries a login or a token, which must not be saved or handed to an agent. Text
 * that is not a URL, such as `owner/repo`, carries none.
 */
export function carriesSecret(link: string): boolean {
  const url = URL.parse(link);

  if (url === null) return false;

  if (url.username !== "" || url.password !== "") return true;

  return (
    params(url).some(([name]) => SECRET_PARAMS.has(name.toLowerCase().replaceAll(/[-_]/g, ""))) ||
    TOKEN.test(url.href)
  );
}

# Trademarks

The [AGPL-3.0](LICENSE) covers Cutfac's code. It doesn't cover the Cutfac name, the logo or the app
icon, which are trademarks of Wyverse Labs. This page says how you can use them, so people can always
tell the official app from a build someone else made.

## Fine without asking

- Running Cutfac built from this repository, changed or not, for yourself or inside your company.
- Saying truthfully what your work is: "a fork of Cutfac", "based on Cutfac", "works with Cutfac".
- Sharing this repository's source, or the app from [cutfac.com](https://cutfac.com), unchanged.
- Writing or making videos about Cutfac.

## Ask first

- Distributing a build you made yourself, free or paid, under the Cutfac name, logo or icon. The
  app from cutfac.com is the only one that ships as Cutfac.
- Using Cutfac, or a name or logo that could be mistaken for it, in the name of a product, company,
  domain or account.
- Anything that suggests Wyverse Labs made, checked or endorses your work.

Ask at [legal@cutfac.com](mailto:legal@cutfac.com) before you do any of these.

## Distributing a fork

Give it its own name and icon, and point it at your own services, so its updates, feedback and
license checks don't reach cutfac.com:

- Name and icon: `productName` in `electron-builder.yml`, `app.setName` in `electron/main.ts`,
  `build/icon.icon`, the logos in `.github/assets/`, and the name where the board shows it.
- Bundle id: `appId` in `electron-builder.yml` and `DEV_APP` in `electron/devApp.ts`.
- Update feed: the `publish` url in `electron-builder.yml`.
- Feedback: `TEAM_FEEDBACK_URL` in `src/core/teamFeedback.ts`.
- License checks: `LICENSE_URL` in `electron/license.ts` and `PRICING_URL` in `src/plan.ts`.

The AGPL still applies to your fork: if you distribute it, or let others use it over a network,
publish its source under the AGPL-3.0.

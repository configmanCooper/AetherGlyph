# Google Play Console Setup Instructions

This guide is tailored to the current Aetherglyph 1.13.3 Android releases.
Google changes Play Console labels occasionally, but the overall sequence remains
the same. Official Google references are listed at the end.

## Release files

Create **two separate Play Console apps**. Never upload one edition's bundle to
the other listing.

| Edition | Play Console name | Package name | Price | Upload file |
| --- | --- | --- | --- | --- |
| Full game | Aetherglyph: Arcane Duels | `com.configmancooper.aetherglyph` | **$4.99 paid, one-time purchase** | `dist\Aetherglyph-1.13.3-release.aab` |
| Demo | Aetherglyph: Arcane Duels Demo | `com.configmancooper.aetherglyph.demo` | **Free** | `dist\Aetherglyph-Demo-1.13.3.aab` |

Upload the `.aab` files to Google Play. The APK files in `dist\` are for local
device testing and should not be used for a new Play Store release.

Package names are permanent after the first bundle is uploaded. Confirm the
package name shown by Play Console before continuing.

## Exact information sheet

This is the quick copy/paste reference for the fields Play Console will request.

### Full paid game

| Information | Exact value |
| --- | --- |
| App name | `Aetherglyph: Arcane Duels` |
| Package name | `com.configmancooper.aetherglyph` |
| Default language | English (United States) / `en-US` |
| Type | Game |
| Price type | Paid |
| United States base price | **$4.99 USD** |
| Purchase type | One-time paid app |
| Developer name | `Cooper Unlimited Games` |
| Support email | `rocmat21@gmail.com` |
| Website | `https://configmancooper.github.io/AetherGlyph/` |
| Privacy policy | `https://aetherglyph-server.onrender.com/privacy.html` |
| Data-deletion URL | `https://aetherglyph-server.onrender.com/account-deletion.html` |
| Category | Games → Strategy |
| Ads | No |
| In-app purchases | No |
| Subscriptions | No |
| Login/account required | No |
| Target audience | 13–15, 16–17, 18 and over |
| Version code | `11303` |
| Version name | `1.13.3` |
| Minimum Android | Android 7.0 / API 24 |
| Target Android | API 36 |
| App Bundle | `dist\Aetherglyph-1.13.3-release.aab` |
| Internet use | Required only for online multiplayer |
| Online interaction | Real-time 1v1 gameplay; no text or voice chat |

### Free offline demo

| Information | Exact value |
| --- | --- |
| App name | `Aetherglyph: Arcane Duels Demo` |
| Package name | `com.configmancooper.aetherglyph.demo` |
| Default language | English (United States) / `en-US` |
| Type | Game |
| Price type | Free |
| Developer name | `Cooper Unlimited Games` |
| Support email | `rocmat21@gmail.com` |
| Website | `https://configmancooper.github.io/AetherGlyph/` |
| Privacy policy | `https://configmancooper.github.io/AetherGlyph/client/demo-privacy.html` |
| Category | Games → Strategy |
| Ads | No |
| In-app purchases | No |
| Subscriptions | No |
| Login/account required | No |
| Target audience | 13–15, 16–17, 18 and over |
| Version code | `11303` |
| Version name | `1.13.3-demo` |
| Minimum Android | Android 7.0 / API 24 |
| Target Android | API 36 |
| App Bundle | `dist\Aetherglyph-Demo-1.13.3.aab` |
| Internet use | None; no Internet permission |
| Online interaction | None |

**Important:** Play Console does not normally ask you to type the package name
on the initial **Create app** screen. It reads and permanently assigns the
package name from the first AAB you upload. Verify that the package displayed
after upload exactly matches the table above.

## Before creating the apps

1. Sign in at <https://play.google.com/console>.
2. Finish developer identity verification and accept any pending agreements.
3. Set the public developer name to **Cooper Unlimited Games**.
4. Confirm the support email is `rocmat21@gmail.com`.
5. Create or finish the Google payments profile required for the paid app.
6. Securely back up both upload keys and their ignored properties files:
   - `android\aetherglyph-upload.keystore`
   - `android\keystore.properties`
   - `android\aetherglyph-demo-upload.keystore`
   - `android\demo-keystore.properties`
7. Keep the online services running while Google reviews the full game:
   - <https://aetherglyph-server.onrender.com/healthz>
   - <https://aetherglyph.onrender.com/healthz>

Do not upload the keystores or properties files to Play Console, GitHub, email,
or cloud storage without strong encryption.

## Part 1: Create the paid full-game listing

### 1. Create the app

1. In Play Console, select **Home → Create app**.
2. Enter:

   | Field | Value |
   | --- | --- |
   | Default language | English (United States) |
   | App name | Aetherglyph: Arcane Duels |
   | App or game | Game |
   | Free or paid | **Paid** |
   | Contact email | `rocmat21@gmail.com` |

3. Accept the declarations and select **Create app**.

The app must be created as paid. Once an app has been offered for free, Google
does not allow that package to become paid later.

### 2. Set the price and countries

1. Open **Products → App pricing**.
2. Complete the payments-profile and tax prompts if Play Console shows them.
3. Set the base United States price to **$4.99 USD**.
4. Let Google generate local prices, then review them.
5. Select the countries and regions where the app should be sold.
6. Save the pricing and distribution changes.

The full game has no subscriptions, in-app products, or in-app purchases.

### 3. Complete the main store listing

Open **Grow users → Store presence → Main store listing**. Copy the final text
from `store-listing-android.md`.

| Field | Value |
| --- | --- |
| App name | Aetherglyph: Arcane Duels |
| Short description | Draw glyphs to cast spells in fast, skill-based 1v1 wizard duels. |
| Full description | Copy the **Full description** section from `store-listing-android.md` |
| App category | Games → Strategy |
| Tags | Strategy, Wizard, Spellcasting, Competitive, 1v1 where available |
| Contact email | `rocmat21@gmail.com` |
| Privacy policy | `https://aetherglyph-server.onrender.com/privacy.html` |

Upload these existing graphics:

| Play asset | File or folder | Dimensions |
| --- | --- | --- |
| App icon | `play-assets\full\app-icon-512.png` | 512 × 512 |
| Feature graphic | `play-assets\full\feature-graphic-1024x500.png` | 1024 × 500 |
| Phone screenshots | `play-assets\full\phone\` | 7 × 1080 × 1920 |
| 7-inch tablet screenshots | `play-assets\full\tablet-7\` | 7 × 1440 × 2560 |
| 10-inch tablet screenshots | `play-assets\full\tablet-10\` | 7 × 1620 × 2880 |
| Google Play Games on PC logo | `play-assets\full\google-play-games-pc\logo-600x400.png` | 600 × 400 |
| Google Play Games on PC feature graphic | `play-assets\full\google-play-games-pc\feature-graphic-1920x1080.png` | 1920 × 1080 |
| Google Play Games on PC screenshots | `play-assets\full\google-play-games-pc\screenshots\` | 7 × 1920 × 1080 |

Do not add unsupported claims, rankings, sale language, or keyword lists to the
title or descriptions.

### 4. Complete App content

Open **Policy and programs → App content** and finish every card shown.

#### Privacy policy

Use:

`https://aetherglyph-server.onrender.com/privacy.html`

#### Ads

Select **No, my app does not contain ads**.

#### App access

Select that all functionality is available without special access. There is no
login or account. In the reviewer notes, enter:

> No login or credentials are required. Tutorial, Practice vs AI, and Glyph
> Laboratory work offline. Online Duel connects to the authoritative
> Aetherglyph server.

#### Target audience

The game is not directed at children under 13. Select the age groups that begin
at **13–15**, plus **16–17** and **18 and over**.

Do not select an under-13 age group unless you intentionally redesign and submit
the app under Google Play's Families requirements.

#### Content rating

Complete the IARC questionnaire honestly:

- Game category.
- Mild fantasy wizard combat.
- Human-like fantasy opponents are struck by magical effects.
- No blood, gore, dismemberment, realistic injury, sexual content, gambling,
  drugs, profanity, or horror.
- Online multiplayer exists.
- There is no free-text chat, voice chat, or user-uploaded media.
- Players may enter an optional short display name that opponents can see.

Use the rating Google assigns; do not manually promise a particular rating.

#### News, health, financial and government declarations

Answer **No** where Play Console asks whether this is a news, health, financial,
government, cryptocurrency, lending, or real-money gambling app.

#### Account deletion

The game has no account or sign-in. If Play Console requests a deletion URL,
use:

`https://aetherglyph-server.onrender.com/account-deletion.html`

The app also provides **Settings → Delete my data**.

### 5. Complete the Data safety form

The full game transmits data only when online features are used. Use the
following as a guide, but read each Play Console definition before submitting.

Suggested top-level answers:

- **Does the app collect or share required user-data types?** Yes, it collects
  limited data for online multiplayer.
- **Is data shared with third parties?** No. Render acts as the game's hosting
  service provider; there are no ad networks, analytics providers, or data
  brokers.
- **Can users request deletion?** Yes.
- **Deletion URL:**
  `https://aetherglyph-server.onrender.com/account-deletion.html`
- **Security:** Production cloud connections use HTTPS/WSS. A player can
  deliberately select a private-LAN or custom server; do not claim that an
  independently operated custom server follows Aetherglyph's retention policy.

Data types to review and disclose:

| Data | Required or optional | Purpose | Handling |
| --- | --- | --- | --- |
| Random anonymous user ID | Required only for online play | App functionality, matchmaking, reconnects and ratings | Stored locally and processed by the multiplayer server |
| Optional display name | Optional | Showing a name to the opponent | Stored locally and sent during online play |
| Match inputs and spell gestures | Required only for online play | Authoritative gameplay and anti-cheat validation | Raw gesture paths are processed ephemerally and discarded |
| Match results and numeric rating | Required only for ranked online play | Matchmaking and app functionality | Stored against the anonymous ID |
| IP address and connection/security logs | Inherent to online connections | Security, abuse prevention and connectivity | Retained for up to 30 days |

Do **not** declare advertising ID, contacts, precise location, photos, files,
camera, microphone, health, financial, email, phone number, or real account data;
the app does not request or use them.

If the form treats an optional display name as **Personal info → Name**, disclose
it as optional. If it treats multiplayer inputs as **App activity → App
interactions/other actions**, disclose them for app functionality.

### 6. Upload the first full-game release

Start with **Testing → Internal testing**:

1. Create an internal-testing release.
2. Accept the default **Play App Signing** enrollment. Google holds the app
   signing key; the local keystore remains the upload key.
3. Upload:

   `dist\Aetherglyph-1.13.3-release.aab`

4. Confirm Play Console displays:

   | Field | Expected value |
   | --- | --- |
   | Package | `com.configmancooper.aetherglyph` |
   | Version code | `11303` |
   | Version name | `1.13.3` |
   | Target API | 36 |

5. Release name: `1.13.3 store artwork and icon update`.
6. Suggested release notes:

   ```text
   <en-US>
   Added persistent Glyph world rankings, temporary wizard accounts, ranked and
   unranked matchmaking, opt-in AI fallback opponents, wizard emojis, ranked-match
   spectating, persistent private lobbies, and multiplayer reliability improvements.
   </en-US>
   ```

7. Add internal tester email addresses and publish the internal test.
8. Install the Play-delivered build on a real Android device and test:
   orientation, audio, haptics, offline play, online matchmaking, backgrounding,
   update prompt behavior, and Settings → Delete my data.
9. Review the Play pre-launch report before production.

Paid apps are free for internal testers. Closed/open testers may be required to
purchase the paid app.

### 7. Complete any mandatory closed test

If the developer account is a **personal account created after November 13,
2023**, Google currently requires a closed test before production access:

1. Open **Testing → Closed testing**.
2. Create a tester email list or Google Group.
3. Add at least **12 testers**.
4. Publish the closed-testing release and send testers the opt-in link.
5. Keep at least 12 testers opted in continuously for **14 days**.
6. Collect feedback and fix any issues.
7. When Play Console enables it, complete **Apply for production access**.

Follow the requirement shown in your own Play Console if Google changes the
tester count or duration. Organization accounts may receive a different path.

### 8. Publish the paid app

1. Finish every Dashboard and App content task.
2. Open **Test and release → Production**.
3. Select **Create new release**.
4. Add the already uploaded 1.13.3 bundle from the library.
5. Add the release notes above.
6. Resolve every error; review warnings individually.
7. Select **Next**, review the release, and start the production rollout.
8. Open **Publishing overview** and submit all pending changes for review.
9. Keep both Render services live while Google reviews and after the release.

## Part 2: Create the free demo listing

The demo is a different app and requires its own Play Console listing, testing
track, content forms, store listing, and production release.

### 1. Create the demo app

Use **Home → Create app**:

| Field | Value |
| --- | --- |
| Default language | English (United States) |
| App name | Aetherglyph: Arcane Duels Demo |
| App or game | Game |
| Free or paid | **Free** |
| Contact email | `rocmat21@gmail.com` |

### 2. Demo store listing

Use:

| Field | Value |
| --- | --- |
| App name | Aetherglyph: Arcane Duels Demo |
| Short description | Learn spell glyphs and battle fair AI offline in the free Aetherglyph demo. |
| Category | Games → Strategy |
| Privacy policy | `https://configmancooper.github.io/AetherGlyph/client/demo-privacy.html` |

Suggested full description:

```text
Learn the art of drawn spellcasting in the free, offline Aetherglyph demo.

Trace living glyphs instead of pressing spell buttons. Complete the academy
tutorial, practise against fair Easy, Medium, and Hard AI opponents, experiment
in the Glyph Laboratory, and discover how elemental spells interact.

The demo includes:
- The complete offline academy campaign
- Practice vs AI with post-round coaching
- Glyph Laboratory experimentation
- Portrait, landscape, left-handed, reduced-motion, audio and haptic settings
- No ads, no in-app purchases and no account

The demo has no online multiplayer and requests no Internet permission. Online
duels, private rooms, ranked matchmaking and local-network multiplayer are
available in the paid Aetherglyph: Arcane Duels app.
```

Use the complete demo upload set under `play-assets\demo\`:

- `app-icon-512.png`
- `feature-graphic-1024x500.png`
- Seven offline-only images in each of `phone\`, `tablet-7\`, and `tablet-10\`
- The logo, text-free feature graphic, and seven screenshots under
  `google-play-games-pc\`

Do not use full-edition screenshots that imply online play is included.

### 3. Demo App content answers

Open **Policy and programs → App content** and complete every card:

| Card or question | Answer |
| --- | --- |
| Privacy policy | `https://configmancooper.github.io/AetherGlyph/client/demo-privacy.html` |
| Ads | No, the app does not contain ads |
| App access | No login, membership, credentials, or restricted content |
| Target audience | 13–15, 16–17, and 18 and over |
| Content rating | Mild fantasy combat; no blood, gore, chat, gambling, sexual content, drugs, or profanity |
| Data safety | No developer-collected or shared data; progress and settings remain on-device |
| Account creation | No account creation or sign-in |
| Account deletion | Not applicable; local data can be erased in Settings or by uninstalling |
| News app | No |
| Health app | No |
| Financial features | No |
| Government app | No |
| Real-money gambling | No |

The demo has no `INTERNET` or `ACCESS_NETWORK_STATE` permission and contains no
Socket.IO client or production multiplayer URL. Its native Play update check
communicates through the installed Google Play Store service.

### 4. Upload and test the demo

1. Open **Setup → Advanced settings → App availability** or the current
   countries/regions page and select the countries where the free demo should be
   available. Selecting all supported countries is the simplest default.
2. Open **Testing → Internal testing → Create new release**.
3. Accept Play App Signing.
4. Upload:

   `dist\Aetherglyph-Demo-1.13.3.aab`

5. Confirm:

   | Field | Expected value |
   | --- | --- |
   | Package | `com.configmancooper.aetherglyph.demo` |
   | Version code | `11303` |
   | Version name | `1.13.3-demo` |
   | Target API | 36 |

6. Release name: `1.13.3 demo store artwork and icon update`.
7. Suggested release notes:

   ```text
   <en-US>
   Updated offline package with the latest spell balance, guide references,
   tutorials, title-screen exhibition, and stability improvements.
   </en-US>
   ```

8. Test the Play-delivered build and confirm Online Duel shows the full-game
   purchase notice without attempting a network connection.
9. Complete the same mandatory closed-testing process if Play Console requires
   it for this second app.
10. Create the production release and submit it for review.

## Common rejection-prevention checklist

- [ ] The `.aab` is uploaded to the matching package/listing.
- [ ] Full app price is $4.99 and demo price is free.
- [ ] No ads and no in-app purchases are declared.
- [ ] Privacy URLs load publicly without login.
- [ ] Store screenshots match the edition being submitted.
- [ ] The full game's online servers are live.
- [ ] The Data safety answers match the privacy policy and actual server behavior.
- [ ] Optional display names and anonymous online IDs are disclosed for the full app.
- [ ] The demo is declared offline and contains no claims of included online play.
- [ ] Content rating mentions mild fantasy combat and online interaction where applicable.
- [ ] Target audience does not include children under 13.
- [ ] The pre-launch report has no blocking crashes or compatibility failures.
- [ ] Every update uses a higher `versionCode` and the same edition-specific upload key.

## Future updates

For each update:

1. Increase `versionCode` above `11303`.
2. Increase `versionName`.
3. Rebuild the correct signed AAB.
4. Upload it to the existing listing—never create a replacement app.
5. Add concise release notes.
6. Test through an internal track before production.
7. Keep the upload keys backed up.

## Official Google references

- Create and set up an app:
  <https://support.google.com/googleplay/android-developer/answer/9859152>
- App pricing:
  <https://support.google.com/googleplay/android-developer/answer/6334373>
- Play App Signing:
  <https://support.google.com/googleplay/android-developer/answer/9842756>
- Internal, closed and open testing:
  <https://support.google.com/googleplay/android-developer/answer/9845334>
- New personal-account testing requirements:
  <https://support.google.com/googleplay/android-developer/answer/14151465>
- Prepare and roll out a release:
  <https://support.google.com/googleplay/android-developer/answer/9859348>
- Data safety:
  <https://support.google.com/googleplay/android-developer/answer/10787469>
- Target audience:
  <https://support.google.com/googleplay/android-developer/answer/9867159>
- Content ratings:
  <https://support.google.com/googleplay/android-developer/answer/9898843>

Last reviewed against Google Play documentation: July 24, 2026.

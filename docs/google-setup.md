# Google Cloud setup (one time)

Letterbox talks to Gmail with **your own** OAuth client, so mail goes straight between your Mac
and Google. You do this once; the app then remembers the client.

1. Open <https://console.cloud.google.com/> and create a project (e.g. "Letterbox").
2. **APIs & Services → Library**: enable **Gmail API** and **People API** (People is for
   contact autocomplete; the app works without it).
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Letterbox", your email as support/developer contact.
   - **Data access / Scopes**: add
     `.../auth/gmail.modify`, `.../auth/gmail.settings.basic`,
     `.../auth/contacts.readonly`, `.../auth/contacts.other.readonly`.
   - **Audience**: add your Google accounts (personal and Workspace) as test users, then click
     **Publish app** → *In production*. Leave it unverified.
     *Why:* apps left in "Testing" get refresh tokens that expire every 7 days, which would
     sign you out weekly. Unverified production apps work for up to 100 users; Google shows an
     "unverified app" warning once per account — click **Advanced → Go to Letterbox (unsafe)**.
4. **Clients → Create client → Application type: Desktop app**. Copy the **Client ID** and
   **Client secret** (for desktop apps the secret isn't confidential; Google still requires it).
5. Launch Letterbox, paste both values, then **Sign in with Google**. Add more accounts later in
   **Settings → Accounts**.

Workspace accounts: if your admin restricts third-party apps, they must allow this OAuth client
(Admin console → Security → API controls → App access control).

The client ID/secret are saved in `~/Library/Application Support/com.mikevillargr.letterbox/
google-client.json`; refresh tokens and AI keys are saved in the macOS Keychain.

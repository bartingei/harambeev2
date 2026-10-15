# Campaign expiry lifecycle

## Current behavior

- A campaign reaching its deadline only displays `0 days left`.
- It remains marked active, stays in the discovery feed, and still accepts donations.
- There are currently no organizer controls for extending or closing an expired campaign.
- No database scheduler is enabled, so expiry must be enforced from the stored deadline on every relevant read and donation attempt rather than relying on a background timer.

## Build

1. **Enforce expiry at the database boundary**
   - Treat the campaign as expired after the end of its deadline date in Nairobi time.
   - Reject every donation once that moment passes, regardless of what the browser displays.
   - Add lifecycle timestamps needed to track the 48-hour decision window.
   - After the 48-hour window, treat and persist the campaign as `completed` whenever campaign data is next accessed; all public and organizer-facing behavior will already use the time-derived completed state immediately.

2. **Update public campaign visibility**
   - Discovery will return only active campaigns whose deadlines have not passed.
   - Campaigns created with no deadline remain active in discovery until the organizer closes them.
   - Expired and completed campaigns will remain accessible through their direct campaign links.
   - The campaign page will replace the donation action with a clear `Campaign ended` state and retain its story, amount raised, donors, and updates.
   - Completed campaign links and campaign-specific share images will continue working.

3. **Add the organizer’s 48-hour decision window**
   - Dashboard campaign cards will show an expired status and the time remaining to decide.
   - During that window, provide two actions:
     - **Extend campaign:** choose a new future deadline and return the campaign to the discovery feed.
     - **Close campaign:** immediately mark it completed.
   - Once 48 hours pass, disable extension and show the campaign as completed.
   - Protect both actions so only the campaign owner can use them.

4. **Add campaign duration choices during setup**
   - Replace the current fixed 30-day behavior with a visible duration choice on the campaign creation form.
   - Offer practical durations, with **30 days** selected by default, plus a custom end date and **No deadline**.
   - Validate custom dates so they are in the future.
   - Show `No deadline` instead of a days-left counter throughout discovery, campaign details, and the dashboard.
   - Allow organizers to close a no-deadline campaign from the dashboard; the 48-hour expiry window does not apply to these campaigns.

5. **Keep totals and dashboard history intact**
   - Completed campaigns remain visible in the organizer dashboard.
   - Existing donations and updates remain unchanged.
   - Dashboard totals continue including completed campaigns and their collected amounts.

6. **Verify the complete lifecycle**
   - Test a deadline-passed campaign as a visitor: absent from discovery, direct link available, donations blocked.
   - Test as its organizer: extend within 48 hours, then verify discovery and donations reopen.
   - Test manual closure and a campaign beyond the 48-hour window.
   - Test the 30-day default, a custom end date, and a no-deadline campaign from creation through discovery and dashboard closure.
   - Confirm mobile layouts, metadata, and existing active campaigns still behave normally.

## Technical details

- Use additive database changes and owner-checked server actions.
- Use `Africa/Nairobi` as the deadline timezone; a campaign accepts donations through 11:59:59 PM on its selected deadline date.
- Store no-deadline campaigns with a null deadline; the existing database already permits this.
- Enforce expiry independently in discovery queries, detail responses, and the donation transaction to prevent stale-page or direct-call bypasses.
- Because no scheduler extension is enabled, completion is time-derived immediately and the stored status is reconciled on the next campaign read; no visitor can donate or see it in discovery during that interval.

# Direct-to-organizer M-Pesa payments

Donors pay with an M-Pesa prompt (STK push) on their phone. The money goes straight to the campaign owner's M-Pesa account. Harambee never holds the money. It only records each confirmed payment so the "raised" counter and totals stay accurate. No payout requests are needed.

## Important M-Pesa limit
An STK push can only send money to a **business number** (a Till or Paybill). It cannot send to a personal phone number. So each organizer must have a Till or Paybill. Each one also needs Daraja access for that number, because every prompt is signed with that business's own passkey.

## 1. Payout details on each campaign
- Add a "Where donations go" section to the Start Campaign form:
  - Type: Till number (Buy Goods) or Paybill (with an account number)
  - Business name, shown to donors as "Payments go to: ..."
- Organizers can view and edit these details from their dashboard.
- A campaign can't take donations until its payout details are set. Until then the page says "Donations open soon".

## 2. Organizer Daraja credentials (kept private)
- Organizers enter their Daraja credentials once in a private "Payment setup" area on the dashboard: shortcode, passkey, consumer key and secret.
- These are stored on the server only. Donors and other organizers can never read them. Pages never show them.

## 3. Donation flow
1. The donor enters an amount and their phone number, then taps Confirm.
2. The server sends an STK push to the donor's phone, aimed at the organizer's Till or Paybill.
3. The donor sees "Check your phone and enter your M-Pesa PIN". The page waits for the result.
4. Safaricom tells Harambee whether the payment succeeded. Only a successful payment is recorded with its real M-Pesa receipt, and only then does the counter go up.
5. The donor sees a success screen, or a clear message if the payment was cancelled or failed.

## 4. Harambee's counter
- Keeps tracking the amount raised per campaign, plus the platform-wide total on the home page.
- Counts only confirmed payments. A repeat message from Safaricom about the same payment is never counted twice.

## 5. Testing
- Use your sandbox credentials first, with Safaricom's test numbers.
- Test success, a cancelled prompt and a timeout. Check that the counter updates only on success.
- The current demo donations stay as they are.

## Technical details
- New table `payment_requests`: campaign_id, phone, amount, checkout_request_id (unique), status pending/success/failed, result fields. The browser can't read or write it; only the server can.
- New table `campaign_payout_settings` (private to the owner): shortcode type, shortcode, account ref, display name. The secret keys are stored encrypted and read only by the server.
- New column `campaigns.payout_display_name` that the public can read.
- Server function `startDonation`: checks the campaign is accepting donations, gets an OAuth token, sends the STK push using the organizer's shortcode and passkey, and saves a pending request.
- `src/routes/api/public/mpesa/callback.ts`: matches checkout_request_id against pending requests (Safaricom doesn't sign callbacks, so only known pending IDs are accepted, plus a secret token in the callback URL). On success it calls `record_donation` with the M-Pesa receipt. The update is safe to repeat.
- Polling `getDonationStatus`, plus a fallback STK status check if the callback never arrives.
- Sandbox vs live is set by one setting.

# Tax Packet Organizer

A free, browser-based organizer that turns last year's tax forms into this
year's document checklist. It lists what to prepare, tracks upload status,
flags missing items, and exports a standardized checklist for a certified
public accountant (CPA) to review, or for filing software of the user's
choice. It does not calculate tax, does not file a return, and does not
give tax conclusions.

## What this demo version does

- Build this year's checklist from last year's form types and payers.
- Ask about filing-status, address, and dependent changes first; only
  changed items open follow-up document requests.
- Track each item as not started, uploaded, not applicable (with a reason),
  or pending transcript.
- Section 3 has two paths: manual form entry, or uploading last year's
  return for automatic recognition. Recognition reads the file's text
  inside the visitor's browser only, extracts form types for the user to
  confirm, and never uploads or stores file contents. Payer names are
  left for the user to confirm because machine payer attribution is
  unreliable; scanned returns without a text layer fall back to manual
  entry.
- Cover state tax items for 10 states only: California, Texas, Florida,
  New York, Pennsylvania, Illinois, Ohio, Georgia, North Carolina, and
  Michigan. Texas and Florida have no state personal income tax; the state
  selector notes this, and selecting them does not create a state
  income-tax checklist item.
- Section 5d lists basic IRS-matching reminders (figure-vs-form
  mismatches, missing items, forms present last year but absent this
  year, figures not yet checked against vouchers or form numbers).
  These are check-please prompts, not IRS determinations; anything
  unclear is routed to a CPA.
  with a CPA review signature block. The printable version leads with a
  draft estimate summary (totals by category, each figure traced to its
  evidence file and its two reconciliation states), followed by the
  checklist. Exports contain no Social Security numbers, and dollar
  amounts appear only as user-confirmed evidence figures. Nothing is
  locked to any filing software.

## What it does not do

- No tax calculation, no filing, no eligibility determination, and no
  tax advice. Uncertain items produce a candidate category, a policy
  reference, and a list of questions to take to a tax professional; the
  professional decides.
- No Social Security numbers, ever: they are stripped before amount
  extraction and never stored. Dollar amounts exist only as
  user-confirmed evidence figures: an electronic checklist upload is
  read transiently inside the visitor's browser to propose amount
  candidates, which the user confirms one per item; photo uploads are
  not read (no reliable OCR in this demo) and record file names only.
  Each confirmed figure carries its evidence source and two
  reconciliation states: checked against the voucher, and checked
  against the number on the tax form (match, mismatch with difference,
  or not yet checked). The draft estimate built from these figures is
  labeled a draft, not a return, and requires CPA verification.
  Last-year return recognition reads the file's text transiently
  inside the visitor's browser to extract form types and discards the
  content afterward.
- The subscription section in the app is informational only. Payment is
  not enabled and no free feature is locked.

## Demo status

This is a demo page. It runs entirely in the visitor's browser and keeps
progress in that browser's local storage. Email verification in the demo
shows the code on the page itself because no mail service is connected.
Before any production use, real email verification, transport and storage
encryption, and account isolation must be connected and tested separately.

## Three pages (organize / subscribe / pay)
- Page 1 organizes the packet (changes, prior year, checklist, transcript, draft estimate, IRS reminders, export).
- Page 2 is the Season Pass subscription page: free vs pass comparison, the 7 extra services with their status, expected $49/season for 1 packet ($25 second packet), quarterly one-time, no auto-renew by default, valid to Oct 15.
- Page 3 is a demo checkout only: no real payment, no real card numbers collected, no charge. Confirming demo payment only records a demo order in the browser (localStorage) for later reconciliation when the pass launches; it does not unlock unlaunched features.

## Returning CPA path (section 6b)
- The client may designate last year's CPA (name/contact provided by the client). The platform does not verify or endorse this person; it is the client's own choice, not a platform recommendation.
- The designation is stored locally, carried over to the next login for confirmation, and can be edited or cleared. It appears in the print header and the JSON export (prior_cpa); the CSV checklist format is unchanged.

## License

MIT. See LICENSE.

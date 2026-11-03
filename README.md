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
- Accept user-uploaded transcript alignment (the user downloads their own
  transcript and uploads it here; this tool does not connect to the IRS).
- Cover state tax items for 10 states only: California, Texas, Florida,
  New York, Pennsylvania, Illinois, Ohio, Georgia, North Carolina, and
  Michigan. Texas and Florida have no state personal income tax; the state
  selector notes this, and selecting them does not create a state
  income-tax checklist item.
- Export the same checklist three ways: CSV, JSON, and a printable list
  with a CPA review signature block. Exports contain no Social Security
  numbers and no dollar amounts, and are not locked to any filing software.

## What it does not do

- No tax calculation, no filing, no eligibility determination, and no
  tax advice. Uncertain items produce a candidate category, a policy
  reference, and a list of questions to take to a tax professional; the
  professional decides.
- No Social Security number or amount inputs. Uploads record file names
  only; file contents are not read or stored by this demo page.
- The subscription section in the app is informational only. Payment is
  not enabled and no free feature is locked.

## Demo status

This is a demo page. It runs entirely in the visitor's browser and keeps
progress in that browser's local storage. Email verification in the demo
shows the code on the page itself because no mail service is connected.
Before any production use, real email verification, transport and storage
encryption, and account isolation must be connected and tested separately.

## License

MIT. See LICENSE.

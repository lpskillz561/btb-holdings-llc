// The three execution documents, rendered from a client record.
//
// The legal text here is TEMPLATE, transcribed from the executed samples in
// docs/. It is not generated, and it must not be. A language model that
// rephrases an arbitration clause, a security interest or a remedies paragraph
// has altered a binding obligation while producing something that still reads
// fluently — the worst possible failure mode for this document set. The model's
// only role anywhere near a contract is a covering note.
//
// Merge fields are the client, the dates, the asset identifiers and the figures
// from ./deal. Party names come from ./parties, because BTB Holdings stands in
// the Seller/Creditor/Agent role the samples gave to MH Services LLC.
//
// The three are ONE SET and are generated together: the Finance Agreement is
// Exhibit A to the Purchase Agreement, and the Management Agreement is what
// produces the income that services the note. Any one of them alone describes
// an unexecutable deal.

import { fmtDate, fmtMoney, fmtPct } from "./format";
import {
  roundingDriftCents,
  scheduledTotalCents,
  type DealTerms,
} from "./deal";
import { formatAddress, getSeller, getVenue, getWireInstructions } from "./parties";

export interface ContractContext {
  /** The buying entity — the Series, not the human. */
  buyerLegalName: string;
  buyerAddress: string;
  /** The trust that owns the Series and guarantees the note. */
  trustName: string;
  /** Human behind the trust, for the covering references. */
  clientDisplayName: string;

  unitDescription: string;
  unitVin: string | null;
  /** Where the unit sits — the Collateral Location in Schedule A. */
  collateralLocation: string | null;

  /** ISO dates. */
  agreementDate: string;
  wireDueDate: string | null;
  fundingDate: string | null;
  firstPaymentDate: string | null;
  managementStartDate: string | null;
  managementEndDate: string | null;

  terms: DealTerms;
}

const money = (cents: number) => fmtMoney(cents, { cents: true });
const orBlank = (v: string | null | undefined, hint: string) =>
  v && v.trim() ? v : `__________________ (${hint})`;
const dateOrBlank = (v: string | null | undefined) => (v ? fmtDate(v) : "__________________");

/* ------------------------------------------------------------------ purchase */

export function renderEquipmentPurchaseAgreement(ctx: ContractContext): string {
  const seller = getSeller();
  const wire = getWireInstructions();
  const venue = getVenue();
  const t = ctx.terms;

  return `# Equipment Purchase Agreement

**Buyer Name:** ${ctx.buyerLegalName} ("Buyer")
**Address:** ${ctx.buyerAddress}
**Contract Number:** ${orBlank(null, "assigned on execution")}
**Delivery Terms:** Deliver to ${orBlank(ctx.collateralLocation, "managed location")}

## Agreement

The following is considered the "Sales Order," and the final, complete, and full
understanding and agreement between the parties. Any prior or contemporaneous
agreements, being either verbal or in writing, are considered void and
unenforceable as all agreed-upon conditions, duties, warranties, and liabilities
are contained herein. This means that all parol evidence, extrinsic evidence and
representations, and the like are excluded and cannot bind either party to this
agreement. This agreement also satisfies and complies with the Statute of Frauds.

Although this document is created by the Seller (${seller.legalName}), as the
Buyer, you are responsible for reading this thoroughly before signing it. If you
read through it and have questions, consult your attorney. This agreement has
options for you, the Buyer, and is not considered an adhesion contract.

## I. Parties to the Agreement

${seller.legalName} (hereafter "Seller") is hereby entering in a sales agreement
with Buyer (hereafter "Buyer") for the purchase of:

| Qty | Description |
|---|---|
| 1 | ${ctx.unitDescription} |

The exact description and specifications of the equipment being sold pursuant to
this agreement will be listed at the end of the agreement, along with any
applicable goods, items, or other tangible objects owned by the Seller for the
Buyer's use in creating or otherwise delivering the product(s) subject to this
agreement.

## II. Purchase Price and applicable terms

The agreed-upon consideration for the above-mentioned interest in said Park Model
is **${money(t.purchasePriceCents)}**.

**A.** The Buyer agrees to provide **${money(t.downPaymentCents)}** of the total
above-mentioned price as a down payment. Buyer shall enter into an equipment
finance agreement with Seller in substantially the form attached hereto as
Exhibit A (the "Equipment Finance Agreement") to pay the additional of the
Purchase Price.

**B.** The accepted method of payment includes only Cash, Check, Money Order, ACH
and Wire Transfer. The Buyer agrees to wire the down payment of
${money(t.downPaymentCents)} payable for the benefit of ${seller.legalName}. The
Seller pays escrow fees.

Buyer shall wire ${money(t.downPaymentCents)} on or before
**${dateOrBlank(ctx.wireDueDate)}**.

**Wire Instructions:**

- Bank: ${wire.bankName}
- Account Name: ${wire.accountName}
- Address: ${wire.bankAddress}
- Account Number: ${wire.accountNumber}
- Routing Number: ${wire.routingNumber}

## III. Reserved.

## IV. Title Transfer

**A. Transfer of title.** The title of the equipment passes upon the delivery of
the equipment to the Buyer at the Buyer's address or location provided herein, so
long as Buyer has first made the ${money(t.downPaymentCents)} down payment as
required by Section II(A) and paid any additional administrative costs.
Transportation beyond ${t.transportIncludedMiles.toLocaleString("en-US")} miles is
billed separately to Buyer at ${money(t.transportPerMileCents)}/mile or the rates
charged by the transporter.

## V. Mandatory Arbitration

In the event of any controversy or claim arising out of or relating to this
agreement, or a breach thereof, the parties hereto shall first attempt to settle
the dispute amicably among themselves. If unable to do so, both parties agree to
resolve the dispute through mediation and to bear their own costs. If a
settlement is not reached within one hundred eighty (180) days after the service
of a written demand for mediation, any unresolved controversy or claim shall be
settled by arbitration.

Such arbitration shall be held in ${venue.state} in accordance with the laws of
the State of ${venue.state}, and the rules then obtained from the American
Arbitration Association, as the party first referring the matter to arbitration
shall elect, and the parties consent to the jurisdiction of ${venue.state}.

All claims, disputes, questions, and controversies (hereinafter "controversy")
not resolved by negotiation between the parties shall be submitted to and be
determined by a panel of three arbitrators. Any such arbitration shall be
conducted in ${venue.county}, ${venue.state}. Either party may initiate the
arbitration by giving a written demand for arbitration to the other party by
registered or certified mail, setting forth the nature of the controversy, the
amount involved, if any, the remedy sought, and the name of one arbitrator. The
panel of three arbitrators shall be appointed as follows. The party initiating
the arbitration shall appoint an arbitrator and shall name him in the written
demand for arbitration as aforesaid. Within twenty (20) days after receipt of
said written demand, the other party shall appoint a second arbitrator by written
notice to the initiating party by registered or certified mail. Within thirty
(30) days after the appointment of the second arbitrator, the two arbitrators so
appointed shall appoint a third arbitrator by written notice by registered or
certified mail to the two parties. If either party shall fail to appoint an
arbitrator as above provided, or if the first two arbitrators shall fail to
appoint the third arbitrator as above provided, then said arbitrator, upon
written application of either party, shall be appointed by the Chief Judge of the
United States District Court for the District of ${venue.state}.

The arbitration shall be conducted by the panel of three arbitrators in
accordance with the Commercial Arbitration Rules then in effect of the American
Arbitration Association, except as such rules may be modified for the purpose of
the arbitration proceeding by the action of a majority of the panel and by
written notice by registered or certified mail to each party. The decision of the
arbitrators shall be by majority vote, and the award of the arbitrators shall be
final and binding upon the parties and judgment thereon may be entered in any
court having jurisdiction with respect thereto. Each party shall bear its own
expenses in connection with the preparation and presentation of its case at the
arbitration proceedings. The fees and expenses of the arbitrators and all other
expenses of arbitration (except those referred to in the preceding sentence)
shall be borne equally by the parties to such arbitration.

This agreement to arbitrate and any award rendered pursuant thereto shall be
enforceable under and pursuant to (i) the laws of the State of ${venue.state},
and (ii) Title 9 of the United States Code, as amended, if and to the extent
applicable hereto. The parties hereto hereby submit to the jurisdiction of the
duly-constituted courts of said State for the purpose of enforcement of this
agreement to arbitrate and any and all awards rendered pursuant thereto, provided
that this sentence shall not limit in any way the right of any party hereto to
bring an action or actions to enforce this agreement to arbitrate or any award
rendered pursuant thereto in any other proper forum.

Buyer Initials: _______

## VI. Appendix

The attached sheet to this agreement is hereby incorporated by reference. The
stated purpose in the appendix is to fully notify both parties of the
expectations, obligations, and rights under this contractual agreement. This
appendix via incorporation by reference is also compliant with the Statute of
Frauds. This appendix provides the specifications as well as the unique
modifications, options, and add-ons. This appendix will be titled "Appendix" and
will be the only other document designated as such. A copy of the Appendix will
be titled such, signed by both parties, and attached to the contractual agreement
hereto.

## VII. Governing Law

This agreement shall be governed by and construed in accordance with the laws of
the State of ${venue.state}.

## VIII. Counterparts; E-Signature

The parties may execute this agreement in multiple counterparts, each of which
constitutes an original, and all of which, collectively, constitute only one
agreement. The signature page of each counterpart may be detached from such
counterpart and attached to a single document which shall for all purposes be
treated as an original. Transmittal and receipt of a signed copy of this
agreement via facsimile, electronic mail (including pdf or any electronic
signature complying with the U.S. federal ESIGN Act of 2000) or other
transmission method and any counterpart so delivered shall be deemed to have been
duly and validly delivered and be valid and effective for all purposes.

## IX. Signature

By signing below, you have read this agreement and understand and agree to all
terms, rights, obligations, and provisions contained herein. This agreement is
considered "Executed" upon both parties signing below:

| | |
|---|---|
| ______________________ | ____________ |
| For Buyer — ${ctx.buyerLegalName} | Date |
| ______________________ | ____________ |
| For ${seller.legalName} | Date |

**Specifications:** ${ctx.unitDescription}

**VIN:** ${orBlank(ctx.unitVin, "manufacturer to provide on delivery")}
`;
}

/* ------------------------------------------------------------------- finance */

export function renderEquipmentFinanceAgreement(ctx: ContractContext): string {
  const seller = getSeller();
  const venue = getVenue();
  const t = ctx.terms;
  const drift = roundingDriftCents(t);

  return `# Equipment Financing Agreement (Installment Note)

**Creditor:** ${seller.legalName}
**Debtor:** ${ctx.buyerLegalName}
**Address:** ${ctx.buyerAddress}
${seller.phone ? `**Creditor Phone:** ${seller.phone}` : ""}

${seller.legalName} ("Lender") has drafted this Equipment Finance Agreement
("Agreement") as a "Plain English" Agreement for your convenience. In this
Agreement, "Debtor" means the Buyer identified above, and "Creditor" means Lender.

1. **SECURITY AGREEMENT:** Debtor hereby grants Creditor a security interest
   under the Uniform Commercial Code in the property (collectively the
   "Collateral" and individually an "Item" or "Item of Collateral") described in
   Schedule A attached hereto and incorporated herein. Such security interest is
   granted to secure performance by Debtor of its obligations hereunder and under
   any other present or future agreement with Creditor. The Debtor shall ensure
   that such security interest is and shall remain a first lien security interest.

2. **ASSIGNMENT OF RENTS.** Debtor hereby irrevocably assigns, transfers, and
   sets over unto Lender, all of Debtor's right, title, and interest in and to
   all rents, issues, and profits, now due or to become due, arising out of the
   Equipment. Lender shall have the right, but not the obligation, to collect
   such rents, issues, and profits, and to apply such amounts to the outstanding
   indebtedness secured hereby.

3. **PAYMENTS:** Debtor shall repay Creditor the "Total Advance" shown in
   Schedule A together with interest in the number of periodic installments shown
   in Schedule A. The initial installment payment shall be deemed due as of the
   date indicated in Schedule A and subsequent installment payments shall be due
   on the same day of each month thereafter until paid, whether or not an invoice
   is rendered. Advance Payments, if any are shown in Schedule A, will be used for
   the first payment and any balance will be used for the last payment(s),
   provided that if there is a default, any payments under this Agreement may be
   applied to Debtor's obligation to Creditor in such order as Creditor chooses.
   **The payments owed under this Agreement are to be specifically paid from the
   rental income generated by the equipment.**

4. **NO AGENCY:** DEBTOR ACKNOWLEDGES THAT NO SUPPLIER OF ANY ITEM OR
   INTERMEDIARY NOR ANY AGENT OF EITHER THEREOF IS AN AGENT OF CREDITOR AND
   FURTHER THAT NONE OF SUCH PARTIES IS AUTHORIZED TO WAIVE OR ALTER ANY TERM OR
   CONDITION OF THIS AGREEMENT. NO REPRESENTATION AS TO ANY MATTER BY ANY SUCH
   PARTY SHALL BIND CREDITOR OR AFFECT DEBTOR'S DUTY TO PAY THE INSTALLMENT
   PAYMENTS AND PERFORM ITS OTHER OBLIGATIONS HEREUNDER.

5. **IMPRACTICABILITY; FRUSTRATION OF PURPOSE:** Debtor and Creditor acknowledge
   that the purpose of the equipment financed pursuant to this agreement is to
   furnish transient lodging of less than ${t.maxAverageRentalDays} days. Should
   the equipment no longer function for its intended purpose or rental income is
   not being generated, then Debtor shall be suspended from its monthly
   performance under this agreement until the rental income of the equipment is
   received or stabilized. The suspension of any performance shall not toll any
   statute of limitations.

6. **FINANCING:** THIS AGREEMENT IS SOLELY A FINANCING AGREEMENT. THE CREDITOR
   HAS HAD NO INVOLVEMENT IN THE SELECTION OR PURCHASE OF AND HAS MADE AND HEREBY
   MAKES NO AGREEMENT, REPRESENTATION OR WARRANTY AS TO ANY ITEM OF COLLATERAL.

7. **LOCATION; INSPECTION; USE:** Debtor shall keep, or as to an Item which is
   movable, not remove from the United States, as appropriate, each Item of
   Collateral in Debtor's possession and control at the Collateral Location
   specified in Schedule A or at such other location to which such Item may have
   been moved with prior written consent of Creditor. Upon request, the Creditor
   may inspect the Collateral during normal business hours and enter the premises
   where the Collateral may be located for such purposes. Each Item shall be used
   solely for commercial or business purposes and operated in a careful and proper
   manner in compliance with all applicable governmental requirements and all
   requirements of insurance policies carried hereunder and all manufacturers'
   instructions and warranty requirements.

8. **ALTERATIONS; SECURITY INTEREST COVERAGE:** Without Creditor's prior written
   consent, Debtor shall not make any alterations, additions or improvements to an
   Item of Collateral that detract from its economic value or functional utility.
   All additions and improvements made to an Item shall be deemed accessions
   thereto and shall not be removed if removal impairs the Item's economic value
   or functional utility. The Creditor's security interest shall cover all
   modifications, accessions, additions to and replacements and substitutions for
   the Collateral. Debtor will not make any replacements or substitutions without
   Creditor's prior written consent.

9. **LIMITED POWER OF ATTORNEY:** Debtor hereby irrevocably appoints Creditor as
   Debtor's attorney-in-fact for the following limited purposes: (1) to sign and
   to file or record on Debtor's behalf and in Debtor's name any document Creditor
   deems necessary to perfect or protect Creditor's interest in the Collateral or
   pursuant to the UCC, and (2) to sign, endorse and/or negotiate, on Debtor's
   behalf and in Debtor's name, for Creditor's benefit, any instrument
   representing proceeds from any policy of insurance covering the Collateral to
   pay off the underlying obligation.

10. **Optional GAP Coverage:** At Debtor's election, when available, Creditor may
    offer Debtor GAP coverage provided by Lender for an additional cost to cover
    the remaining amount owed to Creditor in case of loss, damage, or
    inoperability under this agreement. The cost of Lender-provided GAP is
    **${money(t.gapAnnualCents)} per year**.

11. **CREDITOR'S PAYMENT:** If Debtor fails to perform any of its obligations
    hereunder, Creditor may perform such obligation, and Debtor shall reimburse
    Creditor the cost of such performance and related expenses.

12. **DEFAULT.** Failure to pay the obligation on its due date unless paragraph 5
    is applied.

13. **REMEDIES:** Upon default of the obligation Creditor shall have the rights,
    options, duties and remedies of a secured party, and Debtor shall have the
    rights and duties of a Debtor, under the Uniform Commercial Code of
    ${venue.state} or where the property is located.

14. **LITIGATION EXPENSES:** Each party is responsible for its own fees and costs.

15. **ASSIGNMENT:** Without the prior written consent of Creditor, Debtor shall
    not sell, lease or create or allow any lien other than Creditor's security
    interest against an Item of Collateral or assign any of Debtor's obligations
    hereunder. Debtor's obligations are not assignable by operation of law.
    Consent to any of the foregoing applies only in the given instance. Creditor
    may assign, pledge or otherwise transfer any of its rights hereunder without
    notice to Debtor. If Debtor is given notice of any such assignment, Debtor
    shall acknowledge receipt thereof in writing and shall thereafter pay any
    amounts due hereunder as directed in the notice. The rights of an assignee to
    amounts due hereunder shall be free of any claim or defense Debtor may have
    against Creditor, and Debtor agrees not to assert against an assignee any
    claim or defense which Debtor may have against Creditor. Subject to the
    foregoing, this Agreement inures to the benefit of, and is binding upon, the
    heirs, legatees, personal representatives, successors and assigns of the
    parties.

16. **MARKINGS; PERSONAL PROPERTY:** Debtor shall mark the Collateral, or its
    location as requested by Creditor, to indicate Creditor's security interest.
    Debtor will provide Creditor with any real property waivers requested by
    Creditor as to the real property where an Item of Collateral is or is to be
    located.

17. **COMPLIANCE WITH LAW:** Debtor and Creditor intend to comply with all
    applicable laws.

18. **NOTICES:** Notices shall be in writing and sufficient if mailed to the party
    involved, United States mail first class postage prepaid, at its respective
    address set forth above or at such other address as such party may provide on
    notice in accordance herewith. Notice given shall be effective when mailed.
    Debtor shall promptly notify Creditor of any change in Debtor's address.

19. **CHOICE OF LAW; WAIVER OF JURY TRIAL:** THIS AGREEMENT SHALL BE DEEMED FULLY
    EXECUTED AND PERFORMED IN THE STATE OF ${venue.state.toUpperCase()} AND SHALL
    BE GOVERNED BY AND CONSTRUED IN ACCORDANCE WITH THE LAWS THEREOF WITHOUT
    REGARD TO THE CONFLICTS OF LAWS RULES OF SUCH STATE. DEBTOR AGREES TO SUBMIT
    TO THE JURISDICTION OF THE STATE OF ${venue.state.toUpperCase()},
    ${venue.county.toUpperCase()}. EACH CREDITOR AND DEBTOR HEREBY WAIVES ANY
    RIGHT TO TRIAL BY JURY OF ANY ACTION INVOLVING THIS AGREEMENT. THE STATUTE OF
    LIMITATIONS SHALL BE THE LIMITATIONS PERIOD WHERE THE DEBTOR RESIDES OR THE
    SHORTER LIMITATIONS PERIOD BETWEEN THE DEBTOR AND CREDITOR JURISDICTIONS.

20. **GENERAL:** This agreement constitutes the entire agreement of the parties as
    to the subject matter and shall not be amended, altered or changed except by a
    written agreement signed by the parties. Any waiver by Creditor must be in
    writing, and forbearance shall not constitute a waiver. Whenever the context
    of this Agreement requires, the neuter includes the masculine or feminine and
    the singular includes the plural. If there is more than one Debtor named in
    this Agreement, the liability of each shall be joint and several. The titles
    to the paragraphs of this Agreement are solely for the convenience of the
    parties and are not an aid in the interpretation. Any provision declared
    invalid shall be deemed severable from the remaining provisions that shall
    remain in full force and effect. Time is of the essence of this Agreement. The
    obligations of Debtor shall survive the release of security interest in the
    Collateral.

21. **DEBTOR'S WARRANTIES:** DEBTOR CERTIFIES AND WARRANTS: (a) THE FINANCIAL AND
    OTHER INFORMATION WHICH DEBTOR HAS SUBMITTED, OR WILL SUBMIT, TO CREDITOR IN
    CONNECTION WITH THIS AGREEMENT IS, OR SHALL BE AT TIME OF SUBMISSION, TRUE AND
    COMPLETE; (b) THE DEBTOR'S EXACT LEGAL NAME, STATE OF INCORPORATION, LOCATION
    OF ITS CHIEF EXECUTIVE OFFICE AND/OR ITS PLACE OF RESIDENCE AS APPLICABLE,
    HAVE BEEN CORRECTLY IDENTIFIED TO CREDITOR; (c) THIS AGREEMENT HAS BEEN DULY
    AUTHORIZED BY DEBTOR AND UPON EXECUTION BY DEBTOR SHALL CONSTITUTE THE LEGAL,
    VALID AND BINDING OBLIGATION, CONTRACT AND AGREEMENT OF DEBTOR ENFORCEABLE
    AGAINST DEBTOR IN ACCORDANCE WITH ITS TERMS; AND (d) EACH SHOWING PROVIDED BY
    DEBTOR IN CONNECTION HEREWITH MAY BE FULLY RELIED UPON BY CREDITOR
    NOTWITHSTANDING ANY TECHNICAL DEFICIENCY IN ATTESTATION OR OTHERWISE. THE
    PERSON EXECUTING THIS AGREEMENT ON BEHALF OF THE DEBTOR WARRANTS THAT PERSON'S
    DUE AUTHORITY TO DO SO. DEBTOR FURTHER WARRANTS THAT EACH ITEM OF COLLATERAL
    SHALL AT THE TIME CREDITOR FUNDS THE TOTAL ADVANCE BE OWNED BY DEBTOR FREE AND
    CLEAR OF LIENS AND ENCUMBRANCES AND BE IN GOOD CONDITION AND WORKING ORDER.

22. **NO WARRANTIES BY CREDITOR:** CREDITOR MAKES NO REPRESENTATION OR WARRANTY,
    EXPRESSED OR IMPLIED AS TO ANY MATTER WHATSOEVER, INCLUDING, BUT NOT LIMITED
    TO: THE CONDITION, DESIGN, OR QUALITY OF THE EQUIPMENT; THE FITNESS OF THE
    EQUIPMENT FOR USE OR FOR A PARTICULAR PURPOSE; THE MERCHANTABILITY OF THE
    EQUIPMENT; COMPLIANCE OF THE EQUIPMENT WITH THE REQUIREMENTS OF ANY LAWS,
    RULES, SPECIFICATIONS OR CONTRACTS PERTAINING THERETO; PATENT INFRINGEMENT; OR
    LATENT DEFECTS; THE QUALITY OF THE MATERIAL OR WORKMANSHIP OF THE EQUIPMENT OR
    THE CONFORMITY OF THE EQUIPMENT TO THE PROVISIONS AND SPECIFICATIONS OF ANY
    PURCHASE ORDER RELATING THERETO; THE OPERATION, USE OR PERFORMANCE OF THE
    EQUIPMENT OR ANY OTHER REPRESENTATION OR WARRANTY OF ANY KIND, EXPRESSED OR
    IMPLIED, WITH RESPECT TO THE EQUIPMENT. NO DEFECT OR UNFITNESS OF THE
    EQUIPMENT SHALL RELIEVE DEBTOR OF THE OBLIGATION TO PAY OR OF ANY OTHER
    OBLIGATION UNDER THIS AGREEMENT. CREDITOR SHALL HAVE NO LIABILITY TO DEBTOR OR
    ANY PERSON WHOMSOEVER FOR ANY CLAIM, LOSS, DAMAGE, OR EXPENSE (INCLUDING
    ATTORNEY FEES) OF ANY KIND OR NATURE, WHETHER SPECIAL, CONSEQUENTIAL, ECONOMIC
    OR OTHERWISE, CAUSED OR ALLEGED TO BE CAUSED DIRECTLY, INDIRECTLY,
    INCIDENTALLY, OR CONSEQUENTIALLY BY THE EQUIPMENT OR ANY PART THEREOF OR
    PRODUCTS THEREFROM, BY ANY INADEQUACY OF THE EQUIPMENT OR DEFECT OR DEFICIENCY
    THEREIN, BY ANY INCIDENT WHATSOEVER ARISING IN STRICT LIABILITY OR OTHERWISE,
    FROM CREDITOR'S OR DEBTOR'S NEGLIGENCE OR OTHERWISE, BY THE USE OR MAINTENANCE
    THEREOF, OR FOR REPAIR, SERVICING OR ADJUSTMENT THERETO, OR FOR ANY
    INTERRUPTION OF SERVICE OR LOSS OF USE OF THE EQUIPMENT, OR FOR ANY LOSS OF
    BUSINESS OR DAMAGE WHATSOEVER AND HOWSOEVER CAUSED, OR ARISING OUT OF THIS
    AGREEMENT.

23. **ASSUMPTION.** This Agreement may be assumed by written approval of Creditor.

This Agreement is effective only upon execution by an authorized officer of
Creditor following Debtor's execution hereof. Debtor hereby authorizes Creditor to
disburse the Total Advance as reflected on the Pay Proceeds Direction attached to
each Schedule A.

| | |
|---|---|
| **CREDITOR:** ${seller.legalName} | **DEBTOR:** ${ctx.buyerLegalName} |
| By: ______________________ | By: ______________________ |
| Title: ${seller.signatoryTitle} | Title: ______________________ |
| Date: ______________ | Date: ______________ |

---

## SCHEDULE A

| | |
|---|---|
| Amount | **${money(t.financedCents)}** |
| Rate of Interest | ${fmtPct(t.noteRateBps, { digits: 2 })} |
| Funding Date | ${dateOrBlank(ctx.fundingDate)} |
| Number of Monthly Payments | ${t.noteTermMonths.toLocaleString("en-US")} |
| First Monthly Payment due | ${dateOrBlank(ctx.firstPaymentDate)} |
| Monthly Payment Amount | **${money(t.monthlyPaymentCents)}** |
| Total Loan Amount | **${money(t.financedCents)}** |
${
  drift !== 0
    ? `\n> The ${t.noteTermMonths.toLocaleString("en-US")} scheduled payments total ${money(
        scheduledTotalCents(t),
      )}, which differs from the principal of ${money(t.financedCents)} by ${money(
        Math.abs(drift),
      )} through rounding to whole cents. The final installment is adjusted by that amount so the note pays to zero.\n`
    : ""
}
The terms of this Schedule A shall become effective upon the execution and
delivery hereof by the parties hereto.

- **Description of Equipment:** ${ctx.unitDescription}
- **Vehicle Identification Number or Serial Number:** ${orBlank(ctx.unitVin, "manufacturer to provide on delivery")}
- **Collateral Location:** ${orBlank(ctx.collateralLocation, "managed location")}

Signature: ________________________
By its Manager/Trustee
`;
}

/* ---------------------------------------------------------------- management */

export function renderManagementAgreement(ctx: ContractContext): string {
  const seller = getSeller();
  const t = ctx.terms;
  const ownerShare = fmtPct(10_000 - t.revenueSplitBps, { digits: 0 });
  const agentShare = fmtPct(t.revenueSplitBps, { digits: 0 });

  return `# Management and Revenue Share Agreement

In consideration of the covenants herein contained the Owner of the Trailer which
is described in the signature box below (hereinafter called "Owner"), and
${seller.legalName}, a ${seller.stateOfOrganization} limited liability company
(hereinafter called "Agent"), agree as follows:

1. The Owner hereby employs the Agent exclusively to rent, lease, operate and
   manage the Asset known as a modified Park Model Trailer,
   VIN# ${orBlank(ctx.unitVin, "manufacturer to provide on delivery")}, which is
   located on vacant improved land commonly known as
   ${orBlank(ctx.collateralLocation, "managed location")}, upon the terms
   hereinafter set forth for the period beginning
   **${dateOrBlank(ctx.managementStartDate)}** and ending on
   **${dateOrBlank(ctx.managementEndDate)}**.

2. The Owner and Agent mutually accept this agreement and agree as follows:

   (a) Agent shall use due diligence in the management of the premises for the
   period and upon the terms herein provided and agrees to furnish the services of
   its organization for the renting, leasing, operating and managing of the herein
   described Asset.

   (b) Agent shall render quarterly statements of receipts, expenses and charges
   and remit to Owner receipts, less disbursements, and shall remit to the Owner
   any net profits on a monthly basis, if any.

   (c) Reserved.

   (d) **Agent shall ensure the average rental period of customer use of the Asset
   shall be ${t.maxAverageRentalDays} days or less.**

3. The Owner hereby gives to the Agent the following authority and powers and
   agrees that the Agent shall assume the responsibility of the rental of the
   Asset in connection therewith:

   (a) To advertise the availability for rental of the herein described premises
   or any part thereof, and to display "for rent" signs thereon; to sign, and/or
   cancel leases for the premises or any part thereof; to collect rents due or to
   become due and give receipts therefor; to terminate tenancies and to sign and
   serve in the name of the Owner such notices as are appropriate; to institute
   and prosecute actions; to evict tenants and to recover possession of said
   premises; to sue for in the name of the Owner and recover rents and other sums
   due; and when expedient, to settle, compromise, and release such actions or
   suits or reinstate such tenancies. **Any lease executed for the Owner by the
   Agent shall not exceed ${t.maxAverageRentalDays} days.**

   (b) To make or cause to be made and supervise repairs and alterations as
   necessary. If there is not enough money generated from the rental of the
   equipment to cover any expenses, the Agent shall cover the expenses and be
   repaid from future rental income of the Asset.

   (c) To hire, discharge and supervise all labor and employees required for the
   operation and maintenance of the premises; it being agreed that all employees
   shall be deemed employees or contractors of the Agent and not the Owner, and
   that the Owner shall not be responsible for the acts, defaults or negligence if
   reasonable care has been exercised in their appointment and retention of the
   Agent or Agent's employees or contractors.

4. The Owner further agrees:

   (a) That all income derived from the daily rental of the Asset after operating
   expenses shall be split **${agentShare} to the Agent and ${ownerShare} to the
   Owner**.

   (b) Reserved.

   (c) The Owner will NOT be responsible and NOT be liable to pay any additional
   money, remuneration, reimbursement, etc. for the expenses, maintenance,
   operation, insurance requirements, etc. whatsoever to the Agent for the life of
   the Park Model/Trailer. The Agent shall only be able to recover all expenses the
   Agent incurs from the Rental Income, not the Owner.

5. The Agent further agrees:

   (a) To save the Owner harmless and indemnify the Owner from all damage suits in
   connection with the management of the herein described Asset and from liability
   from injury suffered by any employee or other person whomsoever, and to carry,
   at its own expense, necessary public liability and workmen's compensation
   insurance adequate to protect the interests of the parties hereto, which
   policies shall be so written as to protect the Owner in the same manner and to
   the same extent they protect the Agent, and will name the Owner as coinsured.
   The Owner shall not be liable for any error of judgment or for any mistake of
   fact or law, or for anything which it may do or refrain from doing hereinafter.

This Agreement shall be binding upon the successors and assigns of the Agent, and
the heirs, administrators, executors, successors and assigns of the Owner.

IN WITNESS WHEREOF, the parties hereto have affixed or caused to be affixed their
respective signatures below.

| | |
|---|---|
| **OWNER:** ${ctx.buyerLegalName} | **AGENT:** ${seller.legalName} |
| By: ______________________ | By: ______________________ |
| Its: ______________________ | Its: ${seller.signatoryTitle}${seller.signatoryName ? ` — ${seller.signatoryName}` : ""} |
| Date: ______________ | Date: ______________ |
`;
}

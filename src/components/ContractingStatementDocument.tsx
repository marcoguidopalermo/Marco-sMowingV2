// CLIENT STATEMENT — one component, two contexts: the on-screen preview and
// the print view, exactly as SnowContractDocument does it.
//
// THE PRINT RULES ARE EMITTED TWICE, under @media print and under
// .cstmt-print. The print window renders this to the SCREEN first and only
// then calls print(); if that staging render used screen metrics the paginated
// result would be laid out against a geometry that never prints.
//
// Every number here comes from lib/contractingPayments — statementRows and
// projectSettlement. There is deliberately NO arithmetic in this file: a
// document that recomputes its own totals is a document that eventually
// disagrees with the screen it was generated from.
import type {
  ContractingCredit, ContractingInvoice, ContractingPayment, ContractingProject,
} from '../types';
import { PALERMO } from '../lib/contracting';
import { projectSettlement, statementRows } from '../lib/contractingPayments';

const money = (n: number): string =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (ms?: number): string => (ms
  ? new Date(ms).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
  : '—');

const PRINT_RULES = (p: string) => `
${p} { font-size:9.4pt; }
${p} .sheet { max-width:none; margin:0; padding:0 0.4in; }
${p} thead { display:table-header-group; }
${p} tr, ${p} .keep { page-break-inside:avoid; break-inside:avoid; }
${p} h2 { page-break-after:avoid; break-after:avoid; }
`;

const DOC_CSS = `
.cstmt, .cstmt * { box-sizing:border-box; }
.cstmt { font-family:Georgia,'Times New Roman',serif; color:#1a1a1a; font-size:10pt; line-height:1.45; background:#fff; }
.cstmt .sheet { max-width:7.7in; margin:0 auto; padding:0 0.2in; }
.cstmt .hdr { display:flex; justify-content:space-between; align-items:flex-start;
  border-bottom:3px solid ${PALERMO.gold}; padding-bottom:10px; margin-bottom:16px; }
.cstmt .brand { font-size:17pt; font-weight:700; letter-spacing:.02em; color:${PALERMO.slate}; }
.cstmt .sub { font-size:8.4pt; color:#666; letter-spacing:.08em; text-transform:uppercase; margin-top:2px; }
.cstmt .title { text-align:right; }
.cstmt .title .t { font-size:13pt; font-weight:700; color:${PALERMO.slate}; letter-spacing:.06em; text-transform:uppercase; }
.cstmt .title .d { font-size:8.6pt; color:#666; margin-top:3px; }
.cstmt h2 { font-size:9pt; letter-spacing:.12em; text-transform:uppercase; color:${PALERMO.slate};
  border-bottom:1px solid #d8d8d8; padding-bottom:4px; margin:18px 0 8px; font-weight:700; }
.cstmt table { width:100%; border-collapse:collapse; }
.cstmt th { font-size:7.8pt; letter-spacing:.09em; text-transform:uppercase; color:#666;
  text-align:right; padding:4px 6px; border-bottom:1px solid #d8d8d8; font-weight:700; }
.cstmt th.l, .cstmt td.l { text-align:left; }
.cstmt td { padding:5px 6px; border-bottom:1px solid #efefef; font-size:9.2pt; text-align:right;
  font-variant-numeric:tabular-nums; }
.cstmt tr.tot td { border-top:2px solid ${PALERMO.slate}; border-bottom:none; font-weight:700;
  color:${PALERMO.slate}; padding-top:7px; }
.cstmt .muted { color:#888; font-size:8.4pt; }
.cstmt .tm { font-size:8pt; color:#888; font-style:italic; }
.cstmt .due { margin-top:18px; background:${PALERMO.slate}; color:#fff; padding:11px 14px;
  display:flex; justify-content:space-between; align-items:center; }
.cstmt .due .lbl { font-size:9pt; letter-spacing:.12em; text-transform:uppercase; }
.cstmt .due .amt { font-size:15pt; font-weight:700; font-variant-numeric:tabular-nums; }
.cstmt .credit { color:#1c6b3a; }
.cstmt .credbox { margin-top:8px; border:2px solid ${PALERMO.gold}; padding:9px 14px;
  display:flex; justify-content:space-between; align-items:center; background:#fdfaf0; }
.cstmt .credbox .lbl { font-size:8.6pt; letter-spacing:.12em; text-transform:uppercase; color:${PALERMO.slate}; }
.cstmt .credbox .amt { font-size:12.5pt; font-weight:700; color:#8a6100; font-variant-numeric:tabular-nums; }
.cstmt .foot { margin-top:14px; padding-top:8px; border-top:1px solid #e2e2e2;
  font-size:7.8pt; color:#777; display:flex; justify-content:space-between; }
.cstmt .recon { font-size:7.4pt; color:#9a7d1f; }
.cstmt-print { width:8.5in; margin:0 auto; background:#fff; }
${PRINT_RULES('.cstmt-print')}
@media print {
  @page { size:letter; margin:0.5in 0; }
  .cstmt-noprint { display:none !important; }
  ${PRINT_RULES('.cstmt')}
}
`;

export interface StatementDocProps {
  project: ContractingProject;
  invoices: ContractingInvoice[];
  payments: ContractingPayment[];
  credits: ContractingCredit[];
  /** Statement date — passed in, never Date.now() inside a render. */
  asOf: number;
  /** Set on the staging render inside the print window. */
  printMode?: boolean;
}

export default function ContractingStatementDocument({
  project, invoices, payments, credits, asOf, printMode,
}: StatementDocProps) {
  const st = projectSettlement(project, invoices, payments, credits);
  const rows = statementRows(project, invoices, payments);
  const anyReconstructed = rows.some(r => r.reconstructed);

  return (
    <div className={`cstmt${printMode ? ' cstmt-print' : ''}`}>
      <style>{DOC_CSS}</style>
      <div className="sheet">
        <div className="hdr">
          <div>
            <div className="brand">Palermo&rsquo;s Contracting</div>
            <div className="sub">Thunder Bay, Ontario</div>
          </div>
          <div className="title">
            <div className="t">Statement of Account</div>
            <div className="d">As at {dt(asOf)}</div>
          </div>
        </div>

        <table className="keep">
          <tbody>
            <tr>
              <td className="l" style={{ borderBottom: 'none', paddingLeft: 0 }}>
                <div className="muted">Client</div>
                <div style={{ fontSize: '11pt', fontWeight: 700, color: PALERMO.slate }}>
                  {project.client?.name || '—'}
                </div>
                {project.client?.contact && <div className="muted">{project.client.contact}</div>}
              </td>
              <td className="l" style={{ borderBottom: 'none' }}>
                <div className="muted">Project</div>
                <div style={{ fontSize: '11pt', fontWeight: 700, color: PALERMO.slate }}>{project.name}</div>
                {project.propertyRef && <div className="muted">{project.propertyRef}</div>}
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Contract summary by phase</h2>
        <table>
          <thead>
            <tr>
              <th className="l">Phase</th>
              <th>Contract</th>
              <th>Invoiced</th>
              <th>Paid</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {st.phases.map(p => (
              <tr key={p.phaseId}>
                <td className="l">
                  {p.phaseName}
                  {p.complete && <span className="tm"> · complete</span>}
                </td>
                <td>{p.contractTotal == null
                  ? <span className="tm">time &amp; materials</span>
                  : money(p.contractTotal)}
                </td>
                <td>{money(p.invoicedWithHst)}</td>
                <td className={p.paidWithHst > 0 ? 'credit' : undefined}>{money(p.paidWithHst)}</td>
                <td>{money(p.balanceWithHst)}</td>
              </tr>
            ))}
            <tr className="tot">
              <td className="l">Total</td>
              <td>{st.contractTotalFixed > 0 ? money(st.contractTotalFixed) : ''}</td>
              <td>{money(st.invoicedWithHst)}</td>
              <td>{money(st.paidWithHst)}</td>
              <td>{money(st.balanceWithHst)}</td>
            </tr>
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 5 }}>
          Contract figures are pre-HST; invoiced, paid and balance include HST at 13%.
        </div>

        <h2>Account activity</h2>
        <table>
          <thead>
            <tr>
              <th className="l">Date</th>
              <th className="l">Reference</th>
              <th className="l">Description</th>
              <th>Charges</th>
              <th>Payments</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.kind}-${r.id}`}>
                <td className="l">{dt(r.at)}</td>
                <td className="l">{r.ref}</td>
                <td className="l">
                  {r.description}
                  {r.phaseName && <span className="tm"> · {r.phaseName}</span>}
                  {r.reconstructed && <span className="recon"> · reconstructed</span>}
                </td>
                <td>{r.charge ? money(r.charge) : ''}</td>
                <td className="credit">{r.credit ? money(r.credit) : ''}</td>
                <td>{money(r.balance)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="l muted" colSpan={6}>No activity on this account yet.</td></tr>
            )}
          </tbody>
        </table>

        {st.unappliedWithHst > 0.01 && (
          <div className="muted" style={{ marginTop: 8 }}>
            Includes {money(st.unappliedWithHst)} received and not yet applied to a specific invoice.
          </div>
        )}

        <div className="due">
          <span className="lbl">Balance due</span>
          <span className="amt">{money(st.balanceWithHst)}</span>
        </div>
        {/* CREDIT SITS BELOW THE BALANCE, NOT IN THE ACTIVITY LIST. It is not
            revenue and it settles no invoice — putting it in the ledger would
            make it look like either. No HST: nothing has been billed for it. */}
        {st.creditOnAccount > 0.01 && (
          <div className="credbox">
            <span className="lbl">Unapplied credit on account</span>
            <span className="amt">{money(st.creditOnAccount)}</span>
          </div>
        )}
        {st.creditOnAccount > 0.01 && (
          <div className="muted" style={{ marginTop: 5 }}>
            Held on account and not applied to any invoice. No HST is charged until it is billed against.
            It will be applied to a future progress invoice.
          </div>
        )}

        <div className="foot">
          <span>Palermo&rsquo;s Contracting · statement generated {dt(asOf)}</span>
          <span>{anyReconstructed ? 'Payments marked reconstructed are being reconciled to source records.' : ''}</span>
        </div>
      </div>
    </div>
  );
}

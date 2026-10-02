import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../database/prisma.service';
import { FinanceService, TransactionRow, TxNature } from './finance.service';

export const NATURE_LABELS: Record<TxNature, string> = {
  INSCRIPTION: 'Inscription',
  COTISATION: 'Cotisation mensuelle',
  COLLECTE: 'Collecte',
  REMISE_COLLECTE: 'Remise de collecte',
  FONCTIONNEMENT: 'Fonctionnement',
  ACTIVITE: 'Activité / événement',
  AUTRE_DEPENSE: 'Autre dépense',
};
const ENTRY_NATURES: TxNature[] = ['INSCRIPTION', 'COTISATION', 'COLLECTE'];
const EXIT_NATURES: TxNature[] = ['REMISE_COLLECTE', 'FONCTIONNEMENT', 'ACTIVITE', 'AUTRE_DEPENSE'];
const METHOD_LABELS: Record<string, string> = { CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money', VIREMENT: 'Virement', AUTRE: 'Autre' };
const STATUS_LABELS: Record<string, string> = { VALIDE: 'Validé', ANNULE: 'Annulé', EN_ATTENTE: 'En attente' };

const BRAND = 'FF113E7D';
const BRAND_SOFT = 'FFEAF0FB';
const GREEN = 'FF067647';
const RED = 'FFB42318';
const NUMBER_FORMAT = '#,##0;[Red]-#,##0';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const periodMonth = (year: number, month: number) =>
  cap(new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }));

@Injectable()
export class FinanceExportService {
  constructor(private readonly prisma: PrismaService, private readonly finance: FinanceService) {}

  /** Rapport financier d'un mois (month renseigné) ou d'une année entière. */
  async buildReport(year: number, month?: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Année invalide.');
    if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
      throw new BadRequestException('Mois invalide.');
    }

    const start = month ? new Date(Date.UTC(year, month - 1, 1)) : new Date(Date.UTC(year, 0, 1));
    const end = month ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year + 1, 0, 1));
    const periodLabel = month ? periodMonth(year, month) : `Année ${year}`;

    const [rowsDesc, openingEntries, openingExits, debtors] = await Promise.all([
      this.finance.allTransactions({ from: start, to: end }),
      this.prisma.payment.aggregate({
        where: { status: 'VALIDE', amount: { gt: 0 }, paidAt: { lt: start } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({ where: { status: 'VALIDE', spentAt: { lt: start } }, _sum: { amount: true } }),
      this.finance.membersStatus().then((all) => all.filter((m) => m.totalDebt > 0)),
    ]);

    const rows = [...rowsDesc].reverse(); // ordre chronologique dans le rapport
    const valid = rows.filter((r) => r.status === 'VALIDE');
    const sumBy = (nature: TxNature) => valid.filter((r) => r.nature === nature).reduce((s, r) => s + r.amount, 0);
    const opening = (openingEntries._sum.amount ?? 0) - (openingExits._sum.amount ?? 0);
    const totalEntries = ENTRY_NATURES.reduce((s, n) => s + sumBy(n), 0);
    const totalExits = EXIT_NATURES.reduce((s, n) => s + sumBy(n), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Jeunes MIMS';
    wb.created = new Date();

    this.summarySheet(wb, {
      periodLabel,
      opening,
      totalEntries,
      totalExits,
      sumBy,
      debtTotal: debtors.reduce((s, d) => s + d.totalDebt, 0),
      debtorsCount: debtors.length,
    });
    if (!month) this.monthsSheet(wb, year, valid, opening);
    this.transactionsSheet(wb, rows);
    this.arrearsSheet(wb, debtors);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = month
      ? `rapport-financier-${year}-${String(month).padStart(2, '0')}.xlsx`
      : `rapport-financier-${year}.xlsx`;
    return { buffer, filename };
  }

  private styleHeader(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 24;
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    });
  }

  private summarySheet(
    wb: ExcelJS.Workbook,
    d: {
      periodLabel: string;
      opening: number;
      totalEntries: number;
      totalExits: number;
      sumBy: (n: TxNature) => number;
      debtTotal: number;
      debtorsCount: number;
    },
  ) {
    const ws = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 44 }, { width: 22 }];

    ws.mergeCells('A1:B1');
    ws.getCell('A1').value = 'JEUNES MIMS — Rapport financier';
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: BRAND } };
    ws.mergeCells('A2:B2');
    ws.getCell('A2').value = d.periodLabel;
    ws.getCell('A2').font = { bold: true, size: 12 };
    ws.mergeCells('A3:B3');
    ws.getCell('A3').value = `Édité le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} · montants en FCFA · opérations validées uniquement`;
    ws.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF667085' } };

    let r = 5;
    const line = (label: string, value: number, opts: { bold?: boolean; fill?: string; indent?: number; color?: string } = {}) => {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      row.getCell(2).value = value;
      row.getCell(2).numFmt = NUMBER_FORMAT;
      row.getCell(1).alignment = { indent: opts.indent ?? 0 };
      row.font = { bold: opts.bold ?? false, color: opts.color ? { argb: opts.color } : undefined };
      if (opts.fill) row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill! } }));
      r += 1;
    };

    line("Solde d'ouverture", d.opening, { bold: true, fill: BRAND_SOFT });
    r += 1;
    line('ENTRÉES', d.totalEntries, { bold: true, color: GREEN });
    for (const n of ENTRY_NATURES) line(NATURE_LABELS[n], d.sumBy(n), { indent: 2 });
    r += 1;
    line('SORTIES', d.totalExits, { bold: true, color: RED });
    for (const n of EXIT_NATURES) line(NATURE_LABELS[n], d.sumBy(n), { indent: 2 });
    r += 1;
    line('Résultat de la période (entrées − sorties)', d.totalEntries - d.totalExits, { bold: true });
    line('Solde de clôture', d.opening + d.totalEntries - d.totalExits, { bold: true, fill: BRAND_SOFT });
    r += 1;
    line(`Arriérés au ${new Date().toLocaleDateString('fr-FR')} (situation actuelle)`, d.debtTotal, { bold: true, color: RED });
    line('Membres concernés', d.debtorsCount, { indent: 2 });
    ws.getCell(`B${r - 1}`).numFmt = '0';
  }

  private monthsSheet(wb: ExcelJS.Workbook, year: number, valid: TransactionRow[], opening: number) {
    const ws = wb.addWorksheet('Par mois', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Mois', width: 18 },
      { header: 'Entrées', width: 16 },
      { header: 'Sorties', width: 16 },
      { header: 'Résultat', width: 16 },
      { header: 'Solde en fin de mois', width: 22 },
    ];
    this.styleHeader(ws.getRow(1));

    let balance = opening;
    let yearEntries = 0;
    let yearExits = 0;
    for (let m = 1; m <= 12; m += 1) {
      const inMonth = valid.filter((t) => t.date.getUTCMonth() === m - 1);
      const entries = inMonth.filter((t) => t.direction === 'ENTREE').reduce((s, t) => s + t.amount, 0);
      const exits = inMonth.filter((t) => t.direction === 'SORTIE').reduce((s, t) => s + t.amount, 0);
      balance += entries - exits;
      yearEntries += entries;
      yearExits += exits;
      const row = ws.addRow([periodMonth(year, m).replace(` ${year}`, ''), entries, exits, entries - exits, balance]);
      row.getCell(2).font = { color: { argb: GREEN } };
      row.getCell(3).font = { color: { argb: RED } };
    }
    const total = ws.addRow(['Total année', yearEntries, yearExits, yearEntries - yearExits, balance]);
    total.font = { bold: true };
    total.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } }));
    ws.getColumn(2).numFmt = NUMBER_FORMAT;
    ws.getColumn(3).numFmt = NUMBER_FORMAT;
    ws.getColumn(4).numFmt = NUMBER_FORMAT;
    ws.getColumn(5).numFmt = NUMBER_FORMAT;
  }

  private transactionsSheet(wb: ExcelJS.Workbook, rows: TransactionRow[]) {
    const ws = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Date', width: 13 },
      { header: 'Référence', width: 26 },
      { header: 'Nature', width: 22 },
      { header: 'Membre / Motif', width: 32 },
      { header: 'Détail', width: 30 },
      { header: 'Mode', width: 15 },
      { header: 'Entrée (FCFA)', width: 16 },
      { header: 'Sortie (FCFA)', width: 16 },
      { header: 'Statut', width: 12 },
      { header: 'Saisi par', width: 22 },
    ];
    this.styleHeader(ws.getRow(1));

    let entries = 0;
    let exits = 0;
    for (const t of rows) {
      const isEntry = t.direction === 'ENTREE';
      const valid = t.status === 'VALIDE';
      if (valid) {
        if (isEntry) entries += t.amount;
        else exits += t.amount;
      }
      const row = ws.addRow([
        t.date,
        t.reference,
        NATURE_LABELS[t.nature],
        t.label,
        [t.detail, t.cancelReason ? `Annulée : ${t.cancelReason}` : null].filter(Boolean).join(' — '),
        METHOD_LABELS[t.method] ?? t.method,
        isEntry ? t.amount : null,
        isEntry ? null : t.amount,
        STATUS_LABELS[t.status] ?? t.status,
        t.enteredByName,
      ]);
      row.getCell(1).numFmt = 'dd/mm/yyyy';
      if (!valid) row.font = { color: { argb: 'FF98A2B3' }, strike: t.status === 'ANNULE' };
    }

    const total = ws.addRow(['', '', '', 'TOTAL (opérations validées)', '', '', entries, exits, '', '']);
    total.font = { bold: true };
    total.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } }));
    ws.getColumn(7).numFmt = NUMBER_FORMAT;
    ws.getColumn(8).numFmt = NUMBER_FORMAT;
    if (rows.length) ws.autoFilter = { from: 'A1', to: `J${rows.length + 1}` };
  }

  private arrearsSheet(
    wb: ExcelJS.Workbook,
    debtors: { firstName: string; lastName: string; memberCode: string; monthsLate: number; totalDebt: number }[],
  ) {
    const ws = wb.addWorksheet('Arriérés (situation actuelle)', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Membre', width: 32 },
      { header: 'Code', width: 16 },
      { header: 'Mois de retard', width: 16 },
      { header: 'Montant dû (FCFA)', width: 20 },
    ];
    this.styleHeader(ws.getRow(1));
    for (const d of debtors) ws.addRow([`${d.firstName} ${d.lastName}`, d.memberCode, d.monthsLate, d.totalDebt]);
    const total = ws.addRow(['TOTAL', '', debtors.reduce((s, d) => s + d.monthsLate, 0), debtors.reduce((s, d) => s + d.totalDebt, 0)]);
    total.font = { bold: true };
    total.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } }));
    ws.getColumn(4).numFmt = NUMBER_FORMAT;
  }
}
